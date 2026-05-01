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
          <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0B1220;">
            <h2>You are confirmed</h2>
            <p>Your email is now confirmed for Cognetra launch updates and early access announcements.</p>
            <p>Thank you for joining the Founder's Circle waitlist.</p>
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
