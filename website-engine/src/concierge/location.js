import { loadProjectsState } from '../config.js';

/**
 * Unwraps nested message wrappers (ephemeral, viewOnce, etc.).
 */
export function unwrapMessage(msg) {
  if (!msg) return null;
  let m = msg.message || msg;
  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  return m;
}

/**
 * Extracts a location pin from a message or its quoted message.
 */
export function extractLocationFromMessage(msg) {
  if (!msg) return null;
  const m = unwrapMessage(msg);
  if (!m) return null;

  const directLoc = m.locationMessage || m.liveLocationMessage;
  if (directLoc && typeof directLoc.degreesLatitude === 'number') {
    return {
      lat: directLoc.degreesLatitude,
      lon: directLoc.degreesLongitude,
      label: directLoc.name || directLoc.address || directLoc.caption || 'Shared WhatsApp Location Pin',
    };
  }

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  const q =
    quoted.ephemeralMessage?.message ||
    quoted.viewOnceMessage?.message ||
    quoted.viewOnceMessageV2?.message ||
    quoted;

  const quotedLoc = q.locationMessage || q.liveLocationMessage;
  if (quotedLoc && typeof quotedLoc.degreesLatitude === 'number') {
    return {
      lat: quotedLoc.degreesLatitude,
      lon: quotedLoc.degreesLongitude,
      label: quotedLoc.name || quotedLoc.address || quotedLoc.caption || 'Quoted WhatsApp Location Pin',
    };
  }

  return null;
}

/**
 * Geocodes an address or landmark query using OpenStreetMap Nominatim.
 */
export async function geocodeAddress(query) {
  const q = (query || '').trim();
  if (!q) return null;

  // Explicit lat,lon (e.g. "12.9716, 77.5946")
  const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    return { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WeaveAssistant/1.0 (https://github.com/darthnihilus01/weave)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const parts = data[0].display_name.split(',');
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        label: parts.slice(0, 3).join(',').trim(),
      };
    }
  } catch (err) {
    console.warn(`[Location] Nominatim geocode error for "${q}":`, err.message);
  }
  return null;
}

/**
 * Resolves a location from:
 * 1) Attached or quoted WhatsApp location pin
 * 2) Explicit query string
 * 3) Saved default location in projects.json
 * 4) Automatic IP Geolocation
 */
export async function resolveLocation(customQuery = '', msg = null) {
  // 1. WhatsApp pin attached
  if (msg) {
    const pin = extractLocationFromMessage(msg);
    if (pin) return pin;
  }

  const q = (customQuery || '').trim();
  if (q && !['AUTO', 'DEFAULT', 'CURRENT', 'HERE', 'MY LOCATION', 'NONE'].includes(q.toUpperCase())) {
    const geocoded = await geocodeAddress(q);
    if (geocoded) return geocoded;
  }

  // 2. Saved default location
  try {
    const state = loadProjectsState();
    if (
      state.savedLocation &&
      typeof state.savedLocation.lat === 'number' &&
      typeof state.savedLocation.lon === 'number'
    ) {
      return state.savedLocation;
    }
  } catch {}

  // 3. Fallback: IP Geolocation
  try {
    const res = await fetch('https://ipwho.is/', {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
      const label = [data.city, data.region, data.country].filter(Boolean).join(', ');
      return {
        lat: data.latitude,
        lon: data.longitude,
        label: label || 'Current Location',
      };
    }
  } catch {}

  // Default fallback if offline / sandbox
  return {
    lat: 12.9716,
    lon: 77.5946,
    label: 'Bengaluru, Karnataka, India',
  };
}

/**
 * Calculates Haversine great-circle distance between two points in km.
 */
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Calculates real driving road distance and duration via Open Source Routing Machine (OSRM).
 * Falls back to Haversine route heuristics if OSRM is unreachable.
 */
export async function getDistanceAndDuration(pickup, dropoff) {
  try {
    const url = `http://router.project-osrm.org/route/v1/driving/${pickup.lon},${pickup.lat};${dropoff.lon},${dropoff.lat}?overview=false`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WeaveAssistant/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
        const durationMinutes = Math.max(2, Math.round(route.duration / 60));
        return { distanceKm, durationMinutes };
      }
    }
  } catch (err) {
    console.warn('[Routing] OSRM routing failed, using Haversine heuristic:', err.message);
  }

  // Fallback: Haversine distance with 1.35x urban road tortuosity factor
  const straightLine = haversineDistanceKm(pickup.lat, pickup.lon, dropoff.lat, dropoff.lon);
  const roadDistance = Math.round(straightLine * 1.35 * 10) / 10;
  // Estimate ~25 km/h urban average speed
  const duration = Math.max(3, Math.round((roadDistance / 25) * 60));
  return { distanceKm: roadDistance, durationMinutes: duration };
}
