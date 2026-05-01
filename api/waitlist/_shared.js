const crypto = require('crypto');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getSigningSecret() {
  return process.env.WAITLIST_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback_secret_change_me';
}

function signEmailAction(email, action) {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${action}:${normalizeEmail(email)}`)
    .digest('hex');
}

function verifyEmailActionSignature(email, action, signature) {
  if (!signature) return false;
  const expected = signEmailAction(email, action);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
}

function getBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || null;
}

async function supabaseRequest(path, options = {}) {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRole) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase error ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function verifyTurnstileToken({ token, ip }) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: 'missing_token' };

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: !!data.success, reason: data['error-codes']?.[0] || null };
}

async function logWaitlistEvent(event) {
  try {
    await supabaseRequest('waitlist_events', {
      method: 'POST',
      body: {
        event_type: event.eventType,
        email: event.email || null,
        ip: event.ip || null,
        user_agent: event.userAgent || null,
        reason: event.reason || null
      }
    });
  } catch (_err) {
    // Non-blocking audit logging.
  }
}

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) throw new Error('Missing RESEND_API_KEY or RESEND_FROM');
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html
    })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Resend error ${resp.status}: ${text}`);
  }
}

module.exports = {
  EMAIL_REGEX,
  json,
  normalizeEmail,
  hashToken,
  randomToken,
  signEmailAction,
  verifyEmailActionSignature,
  getBaseUrl,
  getClientIp,
  supabaseRequest,
  verifyTurnstileToken,
  logWaitlistEvent,
  sendEmail
};
