const {
  normalizeEmail,
  hashToken,
  signEmailAction,
  getBaseUrl,
  getClientIp,
  supabaseRequest,
  logWaitlistEvent,
  sendEmail
} = require('./_shared');

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  try {
    const url = new URL(req.url, getBaseUrl(req));
    const email = normalizeEmail(url.searchParams.get('email'));
    const token = String(url.searchParams.get('token') || '');
    const home = `${getBaseUrl(req)}/`;
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    if (!email || !token) {
      await logWaitlistEvent({ eventType: 'confirm_invalid', ip, userAgent, reason: 'missing_params' });
      return redirect(res, `${home}?waitlist=invalid`);
    }

    const encodedEmail = encodeURIComponent(email);
    const rows = await supabaseRequest(`waitlist_signups?email=eq.${encodedEmail}&select=id,status,token_hash,token_expires_at`);
    const row = rows?.[0];
    if (!row) {
      await logWaitlistEvent({ eventType: 'confirm_invalid', email, ip, userAgent, reason: 'missing_signup' });
      return redirect(res, `${home}?waitlist=invalid`);
    }
    if (row.status === 'confirmed') {
      await logWaitlistEvent({ eventType: 'confirm_already', email, ip, userAgent });
      return redirect(res, `${home}?waitlist=already-confirmed`);
    }

    const now = Date.now();
    const expiry = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
    if (!row.token_hash || row.token_hash !== hashToken(token)) {
      await logWaitlistEvent({ eventType: 'confirm_invalid', email, ip, userAgent, reason: 'token_mismatch' });
      return redirect(res, `${home}?waitlist=invalid`);
    }
    if (!expiry || Number.isNaN(expiry) || now > expiry) {
      await logWaitlistEvent({ eventType: 'confirm_expired', email, ip, userAgent });
      return redirect(res, `${home}?waitlist=expired`);
    }

    await supabaseRequest(`waitlist_signups?id=eq.${row.id}`, {
      method: 'PATCH',
      body: {
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        token_hash: null,
        token_expires_at: null,
        updated_at: new Date().toISOString()
      }
    });
    await logWaitlistEvent({ eventType: 'confirm_success', email, ip, userAgent });
    const unsubscribeUrl = `${home}/api/waitlist/unsubscribe?email=${encodeURIComponent(email)}&sig=${signEmailAction(email, 'unsubscribe')}`;

    try {
      await sendEmail({
        to: email,
        subject: 'Welcome to the Cognetra waitlist',
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        },
        html: `
          <div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
            You are confirmed. Priority launch updates are now enabled.
          </div>
          <div style="margin:0;padding:24px;background:#F5F7FA;">
            <div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E6EAF0;border-radius:14px;overflow:hidden;">
              <div style="padding:20px 24px;background:#0A0A0C;background-color:#0A0A0C;color:#FFFFFF;border-bottom:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:12px;letter-spacing:0.12em;opacity:0.85;text-transform:uppercase;">Cognetra</div>
                <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">You are confirmed</h1>
              </div>
              <div style="padding:24px;color:#0F172A;">
                <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#0F172A;">Your email is confirmed for Cognetra launch updates and early access announcements.</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#0F172A;">Thank you for joining the Founder's Circle waitlist.</p>
                <div style="margin:0 0 16px;padding:14px;border:1px solid #E6EAF0;border-radius:10px;background:#F8FAFC;">
                  <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;color:#334155;text-transform:uppercase;margin-bottom:8px;">Early launch benefits</div>
                  <ul style="padding-left:18px;margin:0;color:#334155;font-size:13px;line-height:1.7;">
                    <li>Priority access to the first public release.</li>
                    <li>Product updates focused on scientific progress and usability.</li>
                    <li>Occasional invites for focused feedback rounds.</li>
                  </ul>
                </div>
                <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#475467;">Typical update cadence: 1-2 emails/month until launch.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px;">
                  <tr>
                    <td bgcolor="#0F172A" style="border-radius:999px;mso-padding-alt:13px 18px 13px 18px;">
                      <a href="${home}" style="display:inline-block;padding:13px 18px;font-size:16px;line-height:1.2;color:#FFFFFF;text-decoration:none;border-radius:999px;font-weight:600;">Return to website</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;">
                  <a href="${unsubscribeUrl}" style="display:inline-block;min-height:44px;padding:12px 14px;background:#FFFFFF;color:#1F2937;text-decoration:none;border:1px solid #CBD5E1;border-radius:999px;font-weight:600;font-size:13px;line-height:1.2;">Unsubscribe</a>
                </p>
              </div>
              <div style="padding:14px 24px;border-top:1px solid #E6EAF0;background:#FAFAFA;color:#667085;font-size:12px;line-height:1.55;">
                Professional updates only. No noise. No third-party selling of your email.<br/>
                You are receiving this because this email address was used to join the Cognetra waitlist.
              </div>
            </div>
          </div>
        `
      });
    } catch (_emailError) {
      // Confirmation state is already saved. Avoid blocking user redirect.
    }

    return redirect(res, `${home}?waitlist=confirmed`);
  } catch (_error) {
    return redirect(res, `${getBaseUrl(req)}/?waitlist=invalid`);
  }
};
