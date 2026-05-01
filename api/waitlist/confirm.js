const {
  normalizeEmail,
  hashToken,
  getBaseUrl,
  supabaseRequest,
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

    if (!email || !token) return redirect(res, `${home}?waitlist=invalid`);

    const encodedEmail = encodeURIComponent(email);
    const rows = await supabaseRequest(`waitlist_signups?email=eq.${encodedEmail}&select=id,status,token_hash,token_expires_at`);
    const row = rows?.[0];
    if (!row) return redirect(res, `${home}?waitlist=invalid`);
    if (row.status === 'confirmed') return redirect(res, `${home}?waitlist=already-confirmed`);

    const now = Date.now();
    const expiry = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
    if (!row.token_hash || row.token_hash !== hashToken(token)) return redirect(res, `${home}?waitlist=invalid`);
    if (!expiry || Number.isNaN(expiry) || now > expiry) return redirect(res, `${home}?waitlist=expired`);

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

    try {
      await sendEmail({
        to: email,
        subject: 'Welcome to the Cognetra waitlist',
        html: `
          <div style="margin:0;padding:24px;background:#F3F5F8;">
            <div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">
              <div style="padding:20px 24px;background:linear-gradient(135deg,#0C1424,#13213D);color:#FFFFFF;">
                <div style="font-size:12px;letter-spacing:0.12em;opacity:0.85;text-transform:uppercase;">Cognetra</div>
                <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">You are confirmed</h1>
              </div>
              <div style="padding:24px;color:#0F172A;">
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Your email is now confirmed for Cognetra launch updates and early access announcements.</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Thank you for joining the Founder's Circle waitlist.</p>
                <a href="${home}" style="display:inline-block;padding:11px 18px;background:#0F172A;color:#FFFFFF;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;">Return to website</a>
              </div>
              <div style="padding:14px 24px;border-top:1px solid #E5E7EB;background:#FAFAFA;color:#667085;font-size:12px;line-height:1.5;">
                We will only send important launch and access updates.
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
