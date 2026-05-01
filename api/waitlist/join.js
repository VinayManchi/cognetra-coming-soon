const {
  EMAIL_REGEX,
  json,
  normalizeEmail,
  hashToken,
  randomToken,
  signEmailAction,
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
      supabaseRequest(`waitlist_events?email=eq.${encodedEmail}&event_type=in.(join_attempt,join_blocked)&created_at=gte.${encodedWindow}&select=id`),
      supabaseRequest(`waitlist_events?ip=eq.${encodedIp}&event_type=in.(join_attempt,join_blocked)&created_at=gte.${encodedWindow}&select=id`)
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
    const unsubscribeSig = signEmailAction(email, 'unsubscribe');
    const unsubscribeUrl = `${getBaseUrl(req)}/api/waitlist/unsubscribe?email=${encodeURIComponent(email)}&sig=${unsubscribeSig}`;
    await sendEmail({
      to: email,
      subject: 'Confirm your Cognetra waitlist spot',
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      },
      html: `
        <div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
          Confirm your spot to activate Cognetra launch updates.
        </div>
        <div style="margin:0;padding:24px;background:#F5F7FA;">
          <div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E6EAF0;border-radius:14px;overflow:hidden;">
            <div style="padding:20px 24px;background:#0A0A0C;background-color:#0A0A0C;color:#FFFFFF;border-bottom:1px solid rgba(255,255,255,0.08);">
              <div style="font-size:12px;letter-spacing:0.12em;opacity:0.85;text-transform:uppercase;">Cognetra</div>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">Confirm your waitlist request</h1>
            </div>
            <div style="padding:24px;color:#0F172A;">
              <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#0F172A;">Thanks for joining the Cognetra Founder's Circle waitlist.</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#0F172A;">Please confirm your email to activate launch updates and early access notices.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;">
                <tr>
                  <td bgcolor="#D4AF37" style="border-radius:999px;mso-padding-alt:14px 22px 14px 22px;">
                    <a href="${confirmUrl}" style="display:inline-block;padding:14px 22px;font-size:16px;line-height:1.2;font-weight:700;color:#111827;text-decoration:none;border-radius:999px;">Confirm my email</a>
                  </td>
                </tr>
              </table>
              <div style="margin:0 0 16px;padding:14px;border:1px solid #E6EAF0;border-radius:10px;background:#F8FAFC;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;color:#334155;text-transform:uppercase;margin-bottom:8px;">What to expect</div>
                <ul style="padding-left:18px;margin:0;color:#334155;font-size:13px;line-height:1.7;">
                  <li>Privacy-first cognitive training built on peer-reviewed protocols.</li>
                  <li>11 exercises across five cognitive domains.</li>
                  <li>Early access updates for launch and Founder's Circle milestones.</li>
                </ul>
              </div>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#475467;">This secure link expires in 48 hours.</p>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#475467;">No marketing blasts. Only launch and access updates.</p>
              <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#475467;">If you did not request this, you can safely ignore this email.</p>
              <p style="margin:0;">
                <a href="${unsubscribeUrl}" style="display:inline-block;min-height:44px;padding:12px 14px;background:#FFFFFF;color:#1F2937;text-decoration:none;border:1px solid #CBD5E1;border-radius:999px;font-weight:600;font-size:13px;line-height:1.2;">Unsubscribe</a>
              </p>
            </div>
            <div style="padding:14px 24px;border-top:1px solid #E6EAF0;background:#FAFAFA;color:#667085;font-size:12px;line-height:1.55;">
              Train your brain. Own your data. No account required.<br/>
              You are receiving this because this email address was used to join the Cognetra waitlist.
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
