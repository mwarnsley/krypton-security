import { describe, expect, it } from 'vitest';
import { validateLocalMutation } from './localMutationGuard';

function request(
  headers: Record<string, string> = {},
  url = 'http://localhost:3000/api/control'
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      ...headers,
    },
  });
}

describe('local mutation boundary', () => {
  it.each(['localhost', '127.0.0.1'])('accepts same-origin JSON on %s', (hostname) => {
    expect(
      validateLocalMutation(
        request(
          { host: `${hostname}:3000`, origin: `http://${hostname}:3000` },
          `http://${hostname}:3000/api/control`
        )
      )
    ).toBeUndefined();
  });
  it.each([
    { host: '' },
    { origin: '' },
    { origin: 'null' },
    { host: 'evil.test' },
    { origin: 'http://evil.test' },
    { origin: 'http://localhost:4000' },
    { origin: 'http://localhost:3000/' },
    { 'sec-fetch-site': 'cross-site' },
    { host: 'localhost.evil.test:3000' },
    { host: 'localhost:3000, evil.test' },
  ])('rejects invalid authority %j', (headers) => {
    expect(validateLocalMutation(request(headers))?.status).toBe(403);
  });
  it('rejects remote request URLs even with local forwarded headers', () => {
    expect(
      validateLocalMutation(
        request({ 'x-forwarded-host': 'localhost:3000' }, 'http://evil.test/api/control')
      )?.status
    ).toBe(403);
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded', '', 'application/jsonp'])(
    'rejects media type %s',
    (contentType) => {
      expect(validateLocalMutation(request({ 'content-type': contentType }))?.status).toBe(415);
    }
  );
  it('accepts a JSON charset parameter', () => {
    expect(
      validateLocalMutation(request({ 'content-type': 'application/json; charset=utf-8' }))
    ).toBeUndefined();
  });
});
