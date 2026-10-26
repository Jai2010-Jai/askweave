import fs from 'fs';
import path from 'path';
import os from 'os';
import nodemailer from 'nodemailer';

/**
 * Formats a Date object to RFC 5545 / Google Calendar UTC string: YYYYMMDDTHHmmssZ
 */
export function formatIcsDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Escapes characters for iCalendar text fields.
 */
function escapeIcsText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Builds a 1-click Google Calendar "Add Event" template URL as a fallback.
 *
 * @param {object} params
 * @param {string} params.title
 * @param {Date|string|number} params.start
 * @param {Date|string|number} [params.end]
 * @param {string} [params.description]
 * @param {string} [params.location]
 * @returns {string} Google Calendar URL
 */
export function buildGoogleCalendarUrl({
  title,
  start,
  end,
  description = '',
  location = '',
}) {
  const startDate = start ? new Date(start) : new Date();
  const endDate = end ? new Date(end) : new Date(startDate.getTime() + 60 * 60 * 1000); // default 1 hour

  const startStr = formatIcsDate(startDate);
  const endStr = formatIcsDate(endDate);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'New Event',
    dates: `${startStr}/${endStr}`,
  });

  if (description) params.set('details', description);
  if (location) params.set('location', location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Creates an RFC 5545 standard .ics iCalendar file.
 * Using METHOD:REQUEST with ATTENDEE PARTSTAT=ACCEPTED allows Google Calendar
 * to automatically add the event directly onto the user's calendar without manual confirmation.
 *
 * @param {object} params
 * @param {string} params.title
 * @param {Date|string|number} params.start
 * @param {Date|string|number} [params.end]
 * @param {string} [params.description]
 * @param {string} [params.location]
 * @param {string} [params.organizerEmail='']
 * @param {string} [params.attendeeEmail='']
 * @param {string} [params.method='REQUEST']
 * @returns {string} Absolute path to the generated .ics file
 */
export function createIcsFile({
  title,
  start,
  end,
  description = '',
  location = '',
  organizerEmail = '',
  attendeeEmail = '',
  method = 'REQUEST',
}) {
  const startDate = start ? new Date(start) : new Date();
  const endDate = end ? new Date(end) : new Date(startDate.getTime() + 60 * 60 * 1000);
  const now = new Date();

  const uid = `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@whatsappagent`;
  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WhatsApp Agent//Google Calendar Direct Sync//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method.toUpperCase()}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(startDate)}`,
    `DTEND:${formatIcsDate(endDate)}`,
    `SUMMARY:${escapeIcsText(title || 'New Event')}`,
  ];

  if (description) {
    icsLines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  }
  if (location) {
    icsLines.push(`LOCATION:${escapeIcsText(location)}`);
  }
  if (organizerEmail) {
    icsLines.push(`ORGANIZER;CN=Organizer:mailto:${organizerEmail}`);
  }
  if (attendeeEmail) {
    icsLines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=User:mailto:${attendeeEmail}`
    );
  }

  icsLines.push('STATUS:CONFIRMED');
  icsLines.push('TRANSP:OPAQUE');
  icsLines.push('SEQUENCE:0');
  icsLines.push('END:VEVENT');
  icsLines.push('END:VCALENDAR');

  const content = icsLines.join('\r\n') + '\r\n';
  const cleanTitle = (title || 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 30);
  const fileName = `${cleanTitle}-${Date.now()}.ics`;
  const filePath = path.join(os.tmpdir(), fileName);

  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Sends a calendar invitation directly to the owner's Gmail via SMTP with an embedded
 * RFC 5545 iCalendar request. Google Calendar automatically inserts the event directly
 * into the owner's Google Calendar with ZERO clicks or confirmations needed.
 *
 * @param {object} params
 * @param {string} params.to
 * @param {string} params.title
 * @param {Date|string|number} params.start
 * @param {Date|string|number} [params.end]
 * @param {string} [params.description]
 * @param {string} [params.location]
 * @param {object} params.smtpConfig
 * @returns {Promise<{messageId: string, icsPath: string}>}
 */
export async function sendCalendarInviteDirectly({
  to = '',
  title,
  start,
  end,
  description = '',
  location = '',
  smtpConfig,
}) {
  if (!smtpConfig || !smtpConfig.user || !smtpConfig.pass) {
    throw new Error('SMTP is not configured.');
  }

  const icsPath = createIcsFile({
    title,
    start,
    end,
    description,
    location,
    organizerEmail: smtpConfig.user,
    attendeeEmail: to,
    method: 'REQUEST',
  });
  const icsContent = fs.readFileSync(icsPath, 'utf8');

  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass },
  });

  const startDate = start ? new Date(start) : new Date();
  const endDate = end ? new Date(end) : new Date(startDate.getTime() + 60 * 60 * 1000);

  const textBody = [
    `📅 Event: ${title}`,
    `⏰ When: ${startDate.toLocaleString()} – ${endDate.toLocaleTimeString()}`,
    description ? `📝 Details: ${description}` : null,
    location ? `📍 Location: ${location}` : null,
    ``,
    `This event has been automatically added to your Google Calendar (${to}).`,
    ``,
    `Sent by Weave`,
  ]
    .filter(Boolean)
    .join('\n');

  const info = await transporter.sendMail({
    from: smtpConfig.user,
    to,
    subject: `Invitation: ${title}`,
    text: textBody,
    icalEvent: {
      filename: 'invite.ics',
      method: 'REQUEST',
      content: icsContent,
    },
  });

  return { messageId: info.messageId, icsPath };
}
