const {
  EMAIL_REGEX,
  json,
  normalizeEmail,
  hashToken,
  randomToken,
  getBaseUrl,
  getClientIp,
  supabaseRequest,
  verifyTurnstileToken,
  logWaitlistEvent,
  sendEmail
} = require('./_shared');

const TOKEN_TTL_HOURS = 48;
const EMAIL_LIMIT_PER_15_MIN = 3;
const IP_LIMIT_PER_15_MIN = 10;
const DISPOSABLE_DOMAINS = new Set(['mailinator.com', 'guerrillamail.com', 'tempmail.com', '10minutemail.com']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const email = normalizeEmail(body.email);
    const consent = body.consent === true;
    const consentVersion = String(body.consentVersion || 'waitlist_v1');
    const source = String(body.source || 'coming_soon');
    const honeypot = String(body.company || '').trim();
    const turnstileToken = String(body.turnstileToken || '');
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    if (!EMAIL_REGEX.test(email)) return json(res, 400, { error: 'Invalid email address' });
    if (!consent) return json(res, 400, { error: 'Consent is required' });
    if (honeypot) return json(res, 400, { error: 'Invalid request' });
    const domain = email.split('@')[1] || '';
    if (DISPOSABLE_DOMAINS.has(domain)) return json(res, 400, { error: 'Disposable email domains are not allowed' });

    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const encodedWindow = encodeURIComponent(windowStart);
    const encodedEmail = encodeURIComponent(email);
    const encodedIp = encodeURIComponent(clientIp || 'unknown');
    const [emailAttempts, ipAttempts] = await Promise.all([
      supabaseRequest(`waitlist_events?email=eq.${encodedEmail}&event_type=eq.join_attempt&created_at=gte.${encodedWindow}&select=id`),
      supabaseRequest(`waitlist_events?ip=eq.${encodedIp}&event_type=eq.join_attempt&created_at=gte.${encodedWindow}&select=id`)
    ]);
    if ((emailAttempts?.length || 0) >= EMAIL_LIMIT_PER_15_MIN || (ipAttempts?.length || 0) >= IP_LIMIT_PER_15_MIN) {
      await logWaitlistEvent({ eventType: 'join_blocked', email, ip: clientIp, userAgent, reason: 'rate_limited' });
      return json(res, 429, { error: 'Too many attempts. Please try again later.' });
    }

    const turnstile = await verifyTurnstileToken({ token: turnstileToken, ip: clientIp });
    if (!turnstile.ok) {
      await logWaitlistEvent({ eventType: 'join_blocked', email, ip: clientIp, userAgent, reason: `turnstile_${turnstile.reason || 'failed'}` });
      return json(res, 400, { error: 'Bot verification failed. Please retry.' });
    }

    await logWaitlistEvent({ eventType: 'join_attempt', email, ip: clientIp, userAgent, reason: source });
    const existing = await supabaseRequest(`waitlist_signups?email=eq.${encodedEmail}&select=id,status`);
    if (existing?.[0]?.status === 'confirmed') {
      await logWaitlistEvent({ eventType: 'join_already_confirmed', email, ip: clientIp, userAgent });
      return json(res, 200, { ok: true, status: 'already_confirmed' });
    }

    const token = randomToken();
    const tokenHash = hashToken(token);
    const expiry = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const row = {
      email,
      status: 'pending',
      token_hash: tokenHash,
      token_expires_at: expiry,
      consent_at: now,
      consent_version: consentVersion,
      source,
      signup_ip: clientIp,
      signup_user_agent: userAgent,
      updated_at: now
    };

    if (existing?.[0]?.id) {
      await supabaseRequest(`waitlist_signups?id=eq.${existing[0].id}`, { method: 'PATCH', body: row });
    } else {
      await supabaseRequest('waitlist_signups', { method: 'POST', body: row });
    }

    const confirmUrl = `${getBaseUrl(req)}/api/waitlist/confirm?email=${encodeURIComponent(email)}&token=${token}`;
    await sendEmail({
      to: email,
      subject: 'Confirm your Cognetra waitlist spot',
      html: `
        <div style="margin:0;padding:24px;background:#F3F5F8;">
          <div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">
            <div style="padding:20px 24px;background:#0F1F3A;background-color:#0F1F3A;color:#FFFFFF;border-bottom:1px solid rgba(255,255,255,0.08);">
              <div style="font-size:12px;letter-spacing:0.12em;opacity:0.85;text-transform:uppercase;">Cognetra</div>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">Confirm your waitlist request</h1>
            </div>
            <div style="padding:24px;color:#0F172A;">
              <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Thanks for joining the Cognetra Founder's Circle waitlist.</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Please confirm your email to activate launch updates and early access notices.</p>
              <a href="${confirmUrl}" style="display:inline-block;padding:12px 20px;background:#D4AF37;color:#111827;text-decoration:none;border-radius:999px;font-weight:700;font-size:14px;">Confirm my email</a>
              <div style="margin:20px 0 0;padding:14px;border:1px solid #E5E7EB;border-radius:10px;background:#F8FAFC;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;color:#334155;text-transform:uppercase;margin-bottom:8px;">What to expect</div>
                <ul style="padding-left:18px;margin:0;color:#334155;font-size:13px;line-height:1.7;">
                  <li>Privacy-first cognitive training built on peer-reviewed protocols.</li>
                  <li>11 exercises across 5 cognitive domains.</li>
                  <li>Early access updates for launch and Founder's Circle milestones.</li>
                </ul>
              </div>
              <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#475467;">This secure link expires in 48 hours.</p>
              <p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:#475467;">If you did not request this, you can safely ignore this email.</p>
            </div>
            <div style="padding:14px 24px;border-top:1px solid #E5E7EB;background:#FAFAFA;color:#667085;font-size:12px;line-height:1.5;">
              Train your brain. Own your data. No account required.
            </div>
          </div>
        </div>
      `
    });
    await logWaitlistEvent({ eventType: 'confirmation_sent', email, ip: clientIp, userAgent });

    return json(res, 200, { ok: true, status: 'pending_confirmation' });
  } catch (error) {
    const debug = process.env.NODE_ENV === 'production' ? undefined : String(error && error.message ? error.message : 'unknown');
    return json(res, 500, { error: 'Failed to process waitlist signup', debug });
  }
};
