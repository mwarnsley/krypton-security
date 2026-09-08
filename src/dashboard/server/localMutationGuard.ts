const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Rejects mutations outside the local same-origin JSON browser boundary.
 *
 * @param {Request} request - Incoming request; forwarded headers are never trusted.
 * @returns {Response | undefined} A rejection, or undefined when headers are valid.
 * @complexity O(L) time and space for bounded header parsing; O(1) average host lookup.
 * @example
 * // A localhost JSON request with matching Host and Origin proceeds.
 * validateLocalMutation(request);
 * // => undefined, or a 403/415 response
 */
export function validateLocalMutation(request: Request): Response | undefined {
  const denied = (): Response =>
    Response.json(
      { success: false, error: 'A same-origin localhost request is required.' },
      { status: 403 }
    );
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  if (!host || !origin || host.length > 256 || origin.length > 512) return denied();
  try {
    const url = new URL(request.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !LOOPBACK_HOSTS.has(url.hostname) ||
      url.username !== '' ||
      url.password !== '' ||
      host.toLowerCase() !== url.host ||
      origin !== url.origin ||
      (request.headers.has('sec-fetch-site') &&
        request.headers.get('sec-fetch-site') !== 'same-origin')
    )
      return denied();
  } catch {
    return denied();
  }
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    return Response.json(
      { success: false, error: 'Content-Type must be application/json.' },
      { status: 415 }
    );
  }
  return undefined;
}
