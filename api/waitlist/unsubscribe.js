const {
  normalizeEmail,
  verifyEmailActionSignature,
  getBaseUrl,
  getClientIp,
  supabaseRequest,
  logWaitlistEvent
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

  const base = `${getBaseUrl(req)}/`;
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || null;

  try {
    const url = new URL(req.url, getBaseUrl(req));
    const email = normalizeEmail(url.searchParams.get('email'));
    const sig = String(url.searchParams.get('sig') || '');

    if (!email || !verifyEmailActionSignature(email, 'unsubscribe', sig)) {
      await logWaitlistEvent({ eventType: 'unsubscribe_invalid', email: email || null, ip, userAgent });
      return redirect(res, `${base}?waitlist=unsubscribe-invalid`);
    }

    const encodedEmail = encodeURIComponent(email);
    const rows = await supabaseRequest(`waitlist_signups?email=eq.${encodedEmail}&select=id,status`);
    const row = rows?.[0];
    if (!row) {
      await logWaitlistEvent({ eventType: 'unsubscribe_invalid', email, ip, userAgent, reason: 'missing_signup' });
      return redirect(res, `${base}?waitlist=unsubscribe-invalid`);
    }

    await supabaseRequest(`waitlist_signups?id=eq.${row.id}`, {
      method: 'PATCH',
      body: {
        status: 'unsubscribed',
        updated_at: new Date().toISOString()
      }
    });
    await logWaitlistEvent({ eventType: 'unsubscribe_success', email, ip, userAgent });
    return redirect(res, `${base}?waitlist=unsubscribed`);
  } catch (_error) {
    return redirect(res, `${base}?waitlist=unsubscribe-invalid`);
  }
};
