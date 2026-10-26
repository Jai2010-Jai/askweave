import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { googleAuth } from './auth.js';
import { getConnectedUserEmail } from './config.js';

const GOOGLE_API_BASE = 'https://www.googleapis.com';

/**
 * Direct Google Calendar & Gmail integration using OAuth tokens.
 * Works seamlessly without SMTP passwords or app-specific passwords.
 */
export class GoogleServices {
  async getAuthHeaders() {
    const token = await googleAuth.getValidAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  // --- CALENDAR APIS ---

  /**
   * List upcoming calendar events
   */
  async listEvents(maxResults = 10) {
    const headers = await this.getAuthHeaders();
    const timeMin = new Date().toISOString();
    const url = `${GOOGLE_API_BASE}/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
      timeMin
    )}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Failed to list calendar events: ${await res.text()}`);
    }
    const data = await res.json();
    return data.items || [];
  }

  /**
   * Create a new event on Google Calendar
   */
  async createEvent({ summary, description, startIso, endIso, attendees = [] }) {
    const headers = await this.getAuthHeaders();
    const url = `${GOOGLE_API_BASE}/calendar/v3/calendars/primary/events`;

    const body = {
      summary,
      description,
      start: { dateTime: startIso },
      end: { dateTime: endIso },
      attendees: attendees.map((email) => ({ email })),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Failed to create calendar event: ${await res.text()}`);
    }

    return await res.json();
  }

  // --- GMAIL APIS ---

  /**
   * Send email using Gmail API (No SMTP / No App Passwords!)
   * Automatically handles attachments, formatting, and RFC 2822 compilation.
   */
  async sendEmail({ to, subject, body, bodyText, attachmentPaths = [], from = null }) {
    const token = await googleAuth.getValidAccessToken();
    const senderEmail = from || googleAuth.getUserEmail() || getConnectedUserEmail() || undefined;

    const emailSignature = 'Sent by Weave';
    let formattedBody = (body || bodyText || '').trim();
    if (!formattedBody.endsWith(emailSignature)) {
      formattedBody = formattedBody ? `${formattedBody}\n\n${emailSignature}` : emailSignature;
    }

    const attachments = (attachmentPaths || [])
      .filter((p) => p && fs.existsSync(p) && fs.statSync(p).isFile())
      .map((p) => ({
        filename: path.basename(p),
        path: p,
      }));

    const transporter = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });

    const mail = await transporter.sendMail({
      from: senderEmail,
      to,
      subject,
      text: formattedBody,
      attachments,
    });

    const encodedMessage = Buffer.from(mail.message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const url = `${GOOGLE_API_BASE}/gmail/v1/users/me/messages/send`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const isScopeError =
        res.status === 403 ||
        errText.includes('insufficient authentication scopes') ||
        errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT');
      if (isScopeError) {
        const err = new Error('GMAIL_SCOPE_INSUFFICIENT');
        err.code = 'GMAIL_SCOPE_INSUFFICIENT';
        err.details = errText;
        throw err;
      }
      throw new Error(`Gmail API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return {
      messageId: data.id,
      threadId: data.threadId,
      attachmentsCount: attachments.length,
      from: senderEmail || 'me',
      provider: 'gmail_oauth',
    };
  }
}

export const googleServices = new GoogleServices();
