const {
  EMAIL_REGEX,
  json,
  normalizeEmail,
  hashToken,
  randomToken,
  getBaseUrl,
  supabaseRequest,
  sendEmail
} = require('./_shared');

const TOKEN_TTL_HOURS = 48;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const email = normalizeEmail(body.email);
    const consent = body.consent === true;
    const consentVersion = String(body.consentVersion || 'waitlist_v1');
    const source = String(body.source || 'coming_soon');

    if (!EMAIL_REGEX.test(email)) return json(res, 400, { error: 'Invalid email address' });
    if (!consent) return json(res, 400, { error: 'Consent is required' });

    const encodedEmail = encodeURIComponent(email);
    const existing = await supabaseRequest(`waitlist_signups?email=eq.${encodedEmail}&select=id,status`);
    if (existing?.[0]?.status === 'confirmed') {
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
      signup_ip: (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || null,
      signup_user_agent: req.headers['user-agent'] || null,
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
            <div style="padding:20px 24px;background:linear-gradient(135deg,#0C1424,#13213D);color:#FFFFFF;">
              <div style="font-size:12px;letter-spacing:0.12em;opacity:0.85;text-transform:uppercase;">Cognetra</div>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">Confirm your waitlist request</h1>
            </div>
            <div style="padding:24px;color:#0F172A;">
              <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Thanks for joining the Cognetra Founder's Circle waitlist.</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Please confirm your email to activate launch updates and early access notices.</p>
              <a href="${confirmUrl}" style="display:inline-block;padding:12px 20px;background:#D4AF37;color:#111827;text-decoration:none;border-radius:999px;font-weight:700;font-size:14px;">Confirm my email</a>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#475467;">This secure link expires in 48 hours.</p>
              <p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:#475467;">If you did not request this, you can ignore this email.</p>
            </div>
            <div style="padding:14px 24px;border-top:1px solid #E5E7EB;background:#FAFAFA;color:#667085;font-size:12px;line-height:1.5;">
              Privacy-first by design. No account required. Data remains on-device by default.
            </div>
          </div>
        </div>
      `
    });

    return json(res, 200, { ok: true, status: 'pending_confirmation' });
  } catch (error) {
    const debug = process.env.NODE_ENV === 'production' ? undefined : String(error && error.message ? error.message : 'unknown');
    return json(res, 500, { error: 'Failed to process waitlist signup', debug });
  }
};
