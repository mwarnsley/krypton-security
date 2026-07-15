import { createConnection } from 'node:net';

const IPC_HOST = '127.0.0.1';
const IPC_PORT = 9000;
const IPC_TIMEOUT_MS = 2_000;
const IPC_MAX_RECEIPT_BYTES = 64;

/**
 * Dispatches one bounded command to the loopback native daemon.
 *
 * @param {string} command - The validated native IPC command to transmit.
 * @returns {Promise<string>} The bounded execution receipt returned by Rust.
 * @complexity O(L) time and space for command and bounded receipt length L.
 * @example
 * await dispatchNativeCommand('TOGGLE_AUDIT_MODE:true');
 * // => "SUCCESS: AUDIT_MODE_UPDATED"
 */
export function dispatchNativeCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: IPC_HOST, port: IPC_PORT });
    let receipt = '';

    socket.setTimeout(IPC_TIMEOUT_MS);
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.end(command, 'utf8');
    });
    socket.on('data', (chunk: string) => {
      receipt += chunk;

      if (Buffer.byteLength(receipt, 'utf8') > IPC_MAX_RECEIPT_BYTES) {
        socket.destroy();
        reject(new Error('The native vanguard IPC receipt is oversized.'));
      }
    });
    socket.once('end', () => {
      resolve(receipt.trim());
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('The native vanguard IPC connection timed out.'));
    });
    socket.once('error', reject);
  });
}
