function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function handleCTraderOAuthPublicCallback(request) {
  if (request.method !== 'GET') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim();
  const error = String(url.searchParams.get('error') || url.searchParams.get('errorCode') || '').trim();

  if (error) {
    const location = `/?ctrader_error=${encodeURIComponent(error)}`;
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
  }
  if (!code) return json({ ok: false, reason: 'CTRADER_OAUTH_CODE_MISSING' }, 400);

  const location = `/?ctrader_code=${encodeURIComponent(code)}`;
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}
