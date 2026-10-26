import fs from 'fs';
import path from 'path';
import { DATA_DIR, atomicWriteJson } from '../../config.js';

const CREDENTIALS_FILE = path.join(DATA_DIR, '.credentials.json');

/**
 * Loads Swiggy credentials from .credentials.json or environment variables.
 */
export function getSwiggyCredentials() {
  if (process.env.SWIGGY_AUTH_TOKEN) {
    return {
      accessToken: process.env.SWIGGY_AUTH_TOKEN.trim(),
      source: 'env',
      expiresAt: null,
    };
  }

  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
      if (creds?.swiggy?.accessToken) {
        return {
          ...creds.swiggy,
          source: 'credentials_file',
        };
      }
    } catch {
      // Ignore read errors
    }
  }

  return null;
}

/**
 * Returns active Bearer token if available and valid.
 */
export function getSwiggyToken() {
  const creds = getSwiggyCredentials();
  if (!creds?.accessToken) return null;

  if (creds.expiresAt && Date.now() >= creds.expiresAt - 60000) {
    console.warn('⚠️ [Swiggy Auth] Token has expired or is nearing expiry.');
  }

  return creds.accessToken;
}

/**
 * Persists Swiggy credentials into .credentials.json safely without clearing other tokens.
 */
export function saveSwiggyCredentials({ accessToken, refreshToken = null, expiresIn = null, phone = null }) {
  let existing = {};
  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8')) || {};
    } catch {
      existing = {};
    }
  }

  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

  existing.swiggy = {
    accessToken,
    refreshToken,
    expiresAt,
    phone,
    updatedAt: new Date().toISOString(),
  };

  atomicWriteJson(CREDENTIALS_FILE, existing);
  return existing.swiggy;
}

/**
 * Returns authentication status.
 */
export function getSwiggyAuthStatus() {
  const creds = getSwiggyCredentials();
  if (!creds) {
    return {
      authenticated: false,
      message: 'No Swiggy token found. Set SWIGGY_AUTH_TOKEN in .env or run authentication.',
    };
  }

  const isExpired = creds.expiresAt && Date.now() >= creds.expiresAt;
  return {
    authenticated: !isExpired,
    source: creds.source,
    phone: creds.phone || null,
    expired: !!isExpired,
  };
}
