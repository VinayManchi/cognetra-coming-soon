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
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0B1220;">
          <h2>Confirm your waitlist request</h2>
          <p>Tap the button below to confirm your place on the Cognetra launch waitlist.</p>
          <p><a href="${confirmUrl}" style="display:inline-block;padding:12px 18px;background:#D4AF37;color:#0B1220;text-decoration:none;border-radius:999px;font-weight:700;">Confirm my email</a></p>
          <p style="font-size:13px;color:#475467;">This link expires in 48 hours.</p>
          <p style="font-size:13px;color:#475467;">If you did not request this, you can ignore this email.</p>
        </div>
      `
    });

    return json(res, 200, { ok: true, status: 'pending_confirmation' });
  } catch (error) {
    const debug = process.env.NODE_ENV === 'production' ? undefined : String(error && error.message ? error.message : 'unknown');
    return json(res, 500, { error: 'Failed to process waitlist signup', debug });
  }
};
