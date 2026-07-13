/**
 * Extract the JWT from an incoming Request's Authorization header.
 * Returns null when the header is missing or malformed — the endpoint
 * is responsible for deciding whether to fall back to anon or 401.
 */
export function extractBearer(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (!auth) return null;
  const [scheme, token] = auth.split(' ', 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * The caller's access token: Authorization header first (non-browser
 * clients — tests, curl), then the httpOnly session cookie (the browser
 * since the Phase 0.9 cookie migration). Single seam for every /api/*
 * endpoint and the collab WebSocket upgrade, which can't set headers.
 *
 * CSRF note: cookie-authed mutations are protected by SameSite=Strict on
 * the cookie plus the same-origin check in hooks.server.ts.
 */
export function extractAccessToken(request: Request): string | null {
  const bearer = extractBearer(request);
  if (bearer) return bearer;
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)hour_at=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
