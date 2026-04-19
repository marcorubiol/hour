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
