import type { Readable, Writable } from 'node:stream';

export type McpTransportErrorCode =
  | 'output_closed'
  | 'output_timeout'
  | 'output_failed'
  | 'output_frame_too_large'
  | 'input_frame_too_large'
  | 'input_decode_failed';
export type McpResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
} & (
  | { result: Record<string, unknown>; error?: never }
  | { error: { code: -32700 | -32600 | -32601 | -32602 | -32603; message: string }; result?: never }
);
export interface SessionOptions {
  projectRoot?: string;
  dispatch?: (command: Record<string, unknown>, root: string) => Promise<Record<string, unknown>>;
}
export function createSession(options?: SessionOptions): {
  handle(message: unknown): Promise<McpResponse | undefined>;
};
/** Rejects with McpTransportError on terminal framing or stream failures. */
export function serve(input?: Readable, output?: Writable, options?: SessionOptions): Promise<void>;
