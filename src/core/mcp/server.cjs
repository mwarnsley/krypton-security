#!/usr/bin/env node
const path = require('node:path');
const { TextDecoder } = require('node:util');
const Ajv2020 = require('ajv/dist/2020').default;
const { dispatchNativeControl, NativeControlError } = require('../processIsolation.cjs');

/** A bounded, redacted stdio failure; terminal callers must close the session. */
class McpTransportError extends Error {
  /**
   * Records the transport failure without exposing external exception messages.
   * @param {import('./server.cjs').McpTransportErrorCode} code - Stable transport failure category.
   * @param {unknown} cause - Original failure for local inspection only.
   * @returns {McpTransportError} Typed failure.
   * @complexity O(1) time and space.
   * @example new McpTransportError('output_closed');
   */
  constructor(code, cause) {
    super(code, { cause });
    this.name = 'McpTransportError';
    this.code = code;
  }
}
const OUTPUT_TIMEOUT_MS = 1500;

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const MAX_FRAME = 32768;
const MAX_CONTENT = 2048;
const MAX_PATH = 1024;
const TOOL_FAILURE_MESSAGES = new Map([
  ['invalid_tool_arguments', 'Check the tool input schema and path/content size limits.'],
  ['unavailable', 'Native daemon is unavailable; start it before retrying.'],
  ['native_unavailable', 'Native control failed; verify daemon health before retrying.'],
  [
    'timeout',
    'Native request timed out; write completion is unknown. Inspect the destination before retrying.',
  ],
  [
    'disconnected',
    'Native daemon disconnected; write completion is unknown. Inspect the destination before retrying.',
  ],
  [
    'write_durability_unknown',
    'The write was published but durability is unconfirmed. Inspect the destination before retrying.',
  ],
  ['session_busy', 'A file request is already in progress; wait for its response.'],
]);
const PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const ajv = new Ajv2020({ strict: true, allErrors: false, ownProperties: true });
const pathSchema = {
  type: 'string',
  minLength: 1,
  maxLength: MAX_PATH,
  pattern: '^[^\\u0000-\\u001f\\u007f]+$',
};
const tools = new Map([
  [
    'krypton_read_file',
    {
      name: 'krypton_read_file',
      description:
        'Read at most 2048 UTF-8 bytes from a regular, non-symlink file in the protected workspace through the local native daemon.',
      inputSchema: {
        $schema: DIALECT,
        type: 'object',
        properties: { path: pathSchema },
        required: ['path'],
        additionalProperties: false,
      },
    },
  ],
  [
    'krypton_write_file',
    {
      name: 'krypton_write_file',
      description:
        'Atomically write at most 2048 UTF-8 bytes inside the protected workspace through the local native daemon. Parent directories must exist; symlinks and hardlinks are rejected.',
      inputSchema: {
        $schema: DIALECT,
        type: 'object',
        properties: { path: pathSchema, content: { type: 'string', maxLength: MAX_CONTENT } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  ],
]);
const validators = new Map([...tools].map(([name, tool]) => [name, ajv.compile(tool.inputSchema)]));
const validEnvelope = ajv.compile({
  $schema: DIALECT,
  type: 'object',
  required: ['jsonrpc', 'method'],
  additionalProperties: false,
  properties: {
    jsonrpc: { const: '2.0' },
    method: { type: 'string', minLength: 1, maxLength: 128 },
    id: {
      anyOf: [
        { type: 'string', maxLength: 128 },
        { type: 'integer', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
      ],
    },
    params: { type: 'object' },
  },
});
const validInitialize = ajv.compile({
  $schema: DIALECT,
  type: 'object',
  required: ['protocolVersion', 'capabilities', 'clientInfo'],
  properties: {
    protocolVersion: { type: 'string', maxLength: 32 },
    capabilities: { type: 'object' },
    clientInfo: {
      type: 'object',
      required: ['name', 'version'],
      properties: {
        name: { type: 'string', maxLength: 256 },
        version: { type: 'string', maxLength: 128 },
      },
    },
  },
});
const validCall = ajv.compile({
  $schema: DIALECT,
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 128 },
    arguments: { type: 'object' },
    _meta: { type: 'object' },
  },
});
const validEmptyParams = ajv.compile({
  $schema: DIALECT,
  type: 'object',
  additionalProperties: false,
  properties: { _meta: { type: 'object' } },
});
const validReceipt = ajv.compile({
  $schema: DIALECT,
  type: 'object',
  additionalProperties: false,
  required: ['tool', 'path', 'action', 'telemetry'],
  properties: {
    tool: { enum: [...tools.keys()] },
    path: pathSchema,
    action: { enum: ['allowed', 'denied'] },
    telemetry: { enum: ['queued', 'unavailable', 'not_required'] },
    id: { type: 'string', maxLength: 160 },
    capturedAt: { type: 'string', maxLength: 64 },
  },
});

/**
 * Produces an MCP protocol error without echoing untrusted payloads.
 * @param {string|number|null} id - Correlation ID or null for invalid requests.
 * @param {number} code - JSON-RPC error code.
 * @param {string} message - Fixed safe diagnostic.
 * @returns {object} JSON-RPC error envelope.
 * @complexity O(1) time and auxiliary space.
 * @example protocolError(1, -32601, 'Method not found');
 */
function protocolError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Wraps a local or native tool failure inside a successful JSON-RPC response.
 * @param {string|number} id - Request correlation ID.
 * @param {string} code - Safe bounded failure code.
 * @param {object|undefined} receipt - Validated native evidence, when available.
 * @returns {object} CallToolResult with isError inside result.
 * @complexity O(L) time and space in bounded receipt size L.
 * @example toolError(2, 'native_unavailable');
 */
function toolError(id, code, receipt) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code,
            message:
              TOOL_FAILURE_MESSAGES.get(code) ??
              'File operation denied; check the path, permissions and native daemon health.',
            ...(receipt ? { receipt } : {}),
          }),
        },
      ],
    },
  };
}

/**
 * Creates one stdio session with constant-size lifecycle state and indexed tools.
 * @param {object} options - Optional project root and native dispatch boundary.
 * @returns {{handle: Function}} Serialized message handler; no request history is retained.
 * @complexity O(1) session storage and average Map/Set lookup; validation is O(L) in bounded message bytes L.
 * @example const session = createSession({projectRoot: '/project'});
 */
function createSession(options = {}) {
  const projectRoot =
    options.projectRoot ?? process.env.KRYPTON_PROJECT_ROOT ?? path.resolve(__dirname, '../../..');
  const dispatch = options.dispatch ?? dispatchNativeControl;
  let initialized = false;
  let ready = false;
  let busy = false;

  /**
   * Validates one MCP message and routes file operations exclusively to Rust.
   * @param {unknown} message - Decoded bounded JSON value.
   * @returns {Promise<object|undefined>} Response, or undefined for notifications.
   * @complexity O(L) time and space in bounded JSON/path/content bytes; O(1) session state.
   * @example await handle({jsonrpc:'2.0',id:1,method:'ping'}); // result: {}
   */
  async function handleMessage(message) {
    if (!validEnvelope(message)) return protocolError(null, -32600, 'Invalid Request');
    if (!Object.hasOwn(message, 'id')) {
      if (message.method === 'notifications/initialized' && initialized) ready = true;
      return undefined;
    }
    const { id, method, params } = message;
    if ((method === 'ping' || method === 'tools/list') && !validEmptyParams(params ?? {}))
      return protocolError(id, -32602, 'Invalid parameters');
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'initialize') {
      if (initialized) return protocolError(id, -32600, 'Session already initialized');
      if (!validInitialize(params))
        return protocolError(id, -32602, 'Invalid initialize parameters');
      initialized = true;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOLS.has(params.protocolVersion)
            ? params.protocolVersion
            : '2025-11-25',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'krypton-protected-fs', version: '1.0.0' },
          instructions:
            'Only these two file tools are contained. Paths are relative to the protected workspace. No shell or other host tools are intercepted.',
        },
      };
    }
    if (!ready) return protocolError(id, -32600, 'Session is not initialized');
    if (method === 'tools/list') {
      if (params?.cursor !== undefined) return protocolError(id, -32602, 'Invalid cursor');
      return { jsonrpc: '2.0', id, result: { tools: [...tools.values()] } };
    }
    if (method !== 'tools/call') return protocolError(id, -32601, 'Method not found');
    if (!validCall(params)) return protocolError(id, -32602, 'Invalid tool parameters');
    if (!tools.has(params.name)) return protocolError(id, -32602, 'Unknown tool');
    const args = params.arguments ?? {};
    if (
      !validators.get(params.name)(args) ||
      Buffer.byteLength(args.path) > MAX_PATH ||
      (args.content !== undefined && Buffer.byteLength(args.content) > MAX_CONTENT)
    )
      return toolError(id, 'invalid_tool_arguments');
    if (busy) return toolError(id, 'session_busy');
    busy = true;
    try {
      if (!path.isAbsolute(projectRoot)) return toolError(id, 'invalid_project_root');
      const reply = await dispatch({ type: 'mcp_file', tool: params.name, ...args }, projectRoot);
      if (
        !reply ||
        typeof reply.ok !== 'boolean' ||
        typeof reply.code !== 'string' ||
        !/^[a-z_]{1,128}$/.test(reply.code) ||
        !validReceipt(reply.receipt) ||
        reply.receipt.tool !== params.name ||
        reply.receipt.path !== args.path ||
        reply.receipt.action !== (reply.ok ? 'allowed' : 'denied')
      )
        return toolError(id, 'invalid_native_receipt');
      if (!reply.ok) return toolError(id, reply.code, reply.receipt);
      if (reply.code !== (params.name === 'krypton_read_file' ? 'file_read' : 'file_written'))
        return toolError(id, 'invalid_native_receipt');
      if (
        params.name === 'krypton_read_file' &&
        (typeof reply.content !== 'string' || Buffer.byteLength(reply.content) > MAX_CONTENT)
      )
        return toolError(id, 'invalid_native_receipt');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: false,
          content: [
            {
              type: 'text',
              text:
                params.name === 'krypton_read_file'
                  ? reply.content
                  : JSON.stringify({ code: reply.code, receipt: reply.receipt }),
            },
          ],
        },
      };
    } catch (error) {
      return toolError(id, error instanceof NativeControlError ? error.code : 'native_unavailable');
    } finally {
      busy = false;
    }
  }
  /**
   * Owns unexpected protocol-layer failures while preserving request correlation.
   * @param {unknown} message - Decoded JSON request.
   * @returns {Promise<object|undefined>} A protocol response or notification silence.
   * @complexity O(L) in bounded request bytes, O(1) lifecycle state.
   * @example await handle({jsonrpc:'2.0',id:1,method:'ping'});
   */
  async function handle(message) {
    try {
      return await handleMessage(message);
    } catch (error) {
      const id = message && typeof message === 'object' ? message.id : null;
      if (id === undefined) return undefined;
      return protocolError(
        typeof id === 'string' || typeof id === 'number' ? id : null,
        -32603,
        error instanceof Error ? 'Internal error' : 'Unexpected internal error'
      );
    }
  }
  return { handle };
}

/**
 * Writes one bounded frame while honoring consumer backpressure.
 * @param {import('node:stream').Writable} output - MCP stdout stream.
 * @param {object} response - JSON-RPC response.
 * @returns {Promise<void>} Resolves after the frame is accepted; rejects on output failure.
 * @complexity O(L) time and space in at most MAX_FRAME serialized bytes L.
 * @example await writeResponse(process.stdout, {jsonrpc:'2.0',id:1,result:{}});
 */
async function writeResponse(output, response) {
  const frame = `${JSON.stringify(response)}\n`;
  if (Buffer.byteLength(frame) > MAX_FRAME) throw new McpTransportError('output_frame_too_large');
  await new Promise((resolve, reject) => {
    let settled = false;
    /**
     * Settles one output operation and releases its deadline/listeners.
     * @param {McpTransportError|undefined} error - Safe terminal failure.
     * @returns {void} Settles once.
     * @complexity O(1) time and space.
     * @example finish(undefined); // accepts the frame
     */
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      output.off('close', closed);
      output.off('error', failed);
      if (error) reject(error);
      else resolve();
    };
    /**
     * Converts stream errors into a typed terminal failure.
     * @param {unknown} error - Stream error, retained only as a cause.
     * @returns {void} Rejects the pending write.
     * @complexity O(1) time and space.
     * @example failed(new Error());
     */
    const failed = (error) => finish(new McpTransportError('output_failed', error));
    output.once('error', failed);
    /**
     * Rejects a closed output stream.
     * @returns {void} Rejects the pending write.
     * @complexity O(1) time and space.
     * @example closed();
     */
    const closed = () => finish(new McpTransportError('output_closed'));
    const timer = setTimeout(
      () => finish(new McpTransportError('output_timeout')),
      OUTPUT_TIMEOUT_MS
    );
    output.once('close', closed);
    if (output.destroyed || output.writableEnded) {
      closed();
      return;
    }
    try {
      output.write(frame, (error) => {
        finish(error ? new McpTransportError('output_failed', error) : undefined);
      });
    } catch (error) {
      finish(new McpTransportError('output_failed', error));
    }
  });
}

/**
 * Serves newline-delimited UTF-8 JSON-RPC with bounded input and serialized IPC.
 * @param {import('node:stream').Readable} input - MCP stdin byte stream.
 * @param {import('node:stream').Writable} output - MCP stdout byte stream.
 * @param {object} options - Optional session dependencies.
 * @returns {Promise<void>} Completes on clean EOF; oversized or incomplete framing fails closed.
 * @complexity O(N) byte processing over stream length N, bounded 32 KiB frame storage plus stream high-water marks.
 * @example await serve(process.stdin, process.stdout);
 */
async function serve(input = process.stdin, output = process.stdout, options = {}) {
  const session = createSession(options);
  const frame = Buffer.alloc(MAX_FRAME);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  /**
   * Interrupts idle input when the output channel fails.
   * @param {unknown} error - Stream failure, never exposed to the peer.
   * @returns {void} Destroys the input iterator.
   * @complexity O(1) time and space.
   * @example outputFailed(new Error());
   */
  const outputFailed = (error) => input.destroy(new McpTransportError('output_failed', error));
  /**
   * Interrupts input when a peer closes output between requests.
   * @returns {void} Destroys the input iterator.
   * @complexity O(1) time and space.
   * @example outputClosed();
   */
  const outputClosed = () => input.destroy(new McpTransportError('output_closed'));
  output.on('error', outputFailed);
  output.once('close', outputClosed);
  let completed = false;
  try {
    if (output.destroyed || output.writableEnded) throw new McpTransportError('output_closed');
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let offset = 0;
      while (offset < bytes.length) {
        const newline = bytes.indexOf(10, offset);
        const end = newline === -1 ? bytes.length : newline;
        if (size + end - offset > MAX_FRAME) throw new McpTransportError('input_frame_too_large');
        bytes.copy(frame, size, offset, end);
        size += end - offset;
        offset = end + 1;
        if (newline === -1) continue;
        let message;
        try {
          message = JSON.parse(decoder.decode(frame.subarray(0, size)));
        } catch (error) {
          if (!(error instanceof SyntaxError || error instanceof TypeError))
            throw new McpTransportError('input_decode_failed', error);
          await writeResponse(output, protocolError(null, -32700, 'Parse error'));
          size = 0;
          continue;
        }
        size = 0;
        const response = await session.handle(message);
        if (response) await writeResponse(output, response);
      }
    }
    if (size !== 0) await writeResponse(output, protocolError(null, -32700, 'Parse error'));
    completed = true;
  } finally {
    output.off('close', outputClosed);
    if (!completed) {
      input.destroy();
      output.destroy();
    }
    // Destroy on terminal failure; keep the error handler until pending stream callbacks settle.
    if (size !== 0) input.destroy();
    if (output.closed) output.off('error', outputFailed);
    else output.once('close', () => output.off('error', outputFailed));
  }
}

module.exports = { createSession, serve };
if (require.main === module) {
  void require('../../cli/runtime.cjs').runCli(
    async () => {
      await serve();
      return 0;
    },
    [],
    () => {
      process.stdin.destroy();
      process.stdout.destroy();
    }
  );
}
