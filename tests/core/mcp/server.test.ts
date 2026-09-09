import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const { createSession, serve } = require('../../../src/core/mcp/server.cjs') as {
  createSession(options?: {
    projectRoot?: string;
    dispatch?: (command: Record<string, unknown>, root: string) => Promise<Record<string, unknown>>;
  }): { handle(message: unknown): Promise<Record<string, unknown> | undefined> };
  serve(input: PassThrough, output: Writable, options?: { projectRoot?: string }): Promise<void>;
};
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
};
async function ready(
  dispatch = vi.fn().mockResolvedValue({
    ok: false,
    code: 'path_denied',
    receipt: {
      tool: 'krypton_read_file',
      path: '../outside',
      action: 'denied',
      telemetry: 'queued',
    },
  })
) {
  const session = createSession({ projectRoot: '/project', dispatch });
  await session.handle(initialize);
  await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { session, dispatch };
}
const call = (args: unknown, name = 'krypton_read_file') => ({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name, arguments: args },
});

describe('native MCP session', () => {
  it('requires initialization before file requests', async () => {
    const session = createSession();
    expect(await session.handle(call({ path: 'file' }))).toMatchObject({ error: { code: -32600 } });
  });
  it('lists only the two tools with explicit draft 2020-12 schemas', async () => {
    const { session } = await ready();
    expect(await session.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).toMatchObject({
      result: {
        tools: [
          {
            name: 'krypton_read_file',
            inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema' },
          },
          { name: 'krypton_write_file', inputSchema: { required: ['path', 'content'] } },
        ],
      },
    });
  });
  it('returns native rejection inside CallToolResult, never as a protocol error', async () => {
    const { session, dispatch } = await ready();
    const response = await session.handle(call({ path: '../outside' }));
    expect(response).toMatchObject({
      result: {
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('path_denied') }],
      },
    });
    expect(response).not.toHaveProperty('error');
    expect(dispatch).toHaveBeenCalledWith(
      { type: 'mcp_file', tool: 'krypton_read_file', path: '../outside' },
      '/project'
    );
  });
  it.each([{}, { path: 1 }, { path: '' }, { path: 'file', pid: 123 }, { path: 'x'.repeat(2049) }])(
    'rejects invalid arguments without contacting the daemon %j',
    async (args) => {
      const { session, dispatch } = await ready();
      expect(await session.handle(call(args))).toMatchObject({ result: { isError: true } });
      expect(dispatch).not.toHaveBeenCalled();
    }
  );
  it('requires write content and never coerces it', async () => {
    const { session, dispatch } = await ready();
    expect(
      await session.handle(call({ path: 'file', content: 2 }, 'krypton_write_file'))
    ).toMatchObject({ result: { isError: true } });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('fails closed and redacts raw socket errors', async () => {
    const { session } = await ready(vi.fn().mockRejectedValue(new Error('secret capability')));
    const response = await session.handle(call({ path: 'file' }));
    expect(response).toMatchObject({ result: { isError: true } });
    expect(JSON.stringify(response)).not.toContain('secret capability');
  });
  it.each([
    { ok: true, code: 'file_read' },
    { ok: true, code: 'file_read', content: 'x'.repeat(2049) },
  ])('rejects incomplete native success evidence %j', async (reply) => {
    const { session } = await ready(vi.fn().mockResolvedValue(reply));
    expect(await session.handle(call({ path: 'file' }))).toMatchObject({
      result: { isError: true },
    });
  });
  it('returns bounded native read content', async () => {
    const { session } = await ready(
      vi.fn().mockResolvedValue({
        ok: true,
        code: 'file_read',
        content: 'hello',
        receipt: {
          path: 'file',
          tool: 'krypton_read_file',
          action: 'allowed',
          telemetry: 'not_required',
        },
      })
    );
    expect(await session.handle(call({ path: 'file' }))).toMatchObject({
      result: { isError: false, content: [{ type: 'text', text: 'hello' }] },
    });
  });
  it('does not execute a notification pretending to call a tool', async () => {
    const { session, dispatch } = await ready();
    const notification = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'krypton_read_file', arguments: { path: 'file' } },
    };
    expect(await session.handle(notification)).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('rejects batch requests and null IDs', async () => {
    const { session } = await ready();
    expect(await session.handle([initialize])).toMatchObject({ error: { code: -32600 } });
    expect(await session.handle({ ...initialize, id: null })).toMatchObject({
      error: { code: -32600 },
    });
  });
});

describe('bounded stdio framing', () => {
  it('handles fragmented JSON and emits only newline-delimited JSON-RPC', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => {
      text += String(chunk);
    });
    const done = serve(input, output);
    const request = JSON.stringify(initialize);
    input.write(request.slice(0, 20));
    input.end(request.slice(20) + '\n');
    await done;
    expect(JSON.parse(text)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-11-25' },
    });
  });
  it('fails on an oversized unterminated input frame', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const done = serve(input, output);
    input.end('x'.repeat(32769));
    await expect(done).rejects.toThrow('frame');
  });
});

describe('MCP error boundaries', () => {
  it('fails if stdout closes while waiting for the next request', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const done = serve(input, output);
    output.destroy();
    await expect(done).rejects.toMatchObject({ code: 'output_closed' });
  });
  it('fails immediately if stdout was already closed', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.destroy();
    await expect(serve(input, output)).rejects.toMatchObject({ code: 'output_closed' });
  });
  it('responds with -32603 for an unexpected protocol processing error', async () => {
    const session = createSession();
    const params = {
      get protocolVersion() {
        throw new Error('private detail');
      },
    };
    const result = await session.handle({ ...initialize, params });
    expect(result).toMatchObject({ id: 1, error: { code: -32603 } });
    expect(JSON.stringify(result)).not.toContain('private detail');
  });
  it('reports malformed tool request parameters as protocol errors', async () => {
    const { session, dispatch } = await ready();
    expect(await session.handle(call(null))).toMatchObject({ error: { code: -32602 } });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('redacts non-Error thrown values and keeps the session usable', async () => {
    const { session } = await ready(vi.fn().mockRejectedValue(null));
    expect(await session.handle(call({ path: 'file' }))).toMatchObject({
      result: { isError: true },
    });
    expect(await session.handle({ jsonrpc: '2.0', id: 4, method: 'ping' })).toHaveProperty(
      'result'
    );
  });
  it('bounds stalled stdout writes to 1500ms', async () => {
    vi.useFakeTimers();
    const input = new PassThrough();
    const output = new Writable({
      write() {
        /* simulate a peer that never consumes */
      },
    });
    try {
      const done = serve(input, output);
      const rejection = expect(done).rejects.toMatchObject({ code: 'output_timeout' });
      input.end(JSON.stringify(initialize) + '\n');
      await vi.advanceTimersByTimeAsync(1500);
      await rejection;
    } finally {
      input.destroy();
      output.destroy();
      vi.useRealTimers();
    }
  });
  it('fails immediately when stdout closes before write completion', async () => {
    const input = new PassThrough();
    const output = new Writable({
      write() {
        this.destroy();
      },
    });
    const done = serve(input, output);
    input.end(JSON.stringify(initialize) + '\n');
    await expect(done).rejects.toMatchObject({ code: 'output_closed' });
  });
  it('handles asynchronous stdout errors without an unhandled event', async () => {
    const input = new PassThrough();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('secret'));
      },
    });
    const done = serve(input, output);
    input.end(JSON.stringify(initialize) + '\n');
    await expect(done).rejects.toMatchObject({ code: 'output_failed' });
  });
  it('returns a parse error for incomplete EOF framing', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => {
      text += String(chunk);
    });
    const done = serve(input, output);
    input.end('{');
    await done;
    expect(JSON.parse(text)).toMatchObject({ error: { code: -32700 } });
  });
});
