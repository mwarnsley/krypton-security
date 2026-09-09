import type { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import type { startProtectedProcess, dispatchNativeControl } from './processIsolation.cjs';
export interface SupervisorWorkspace {
  repositoryRoot: string;
  projectRoot: string;
  cwd: string;
}
export interface SupervisorDependencies {
  resolveWorkspace?: () => Promise<SupervisorWorkspace>;
  dispatch?: typeof dispatchNativeControl;
  start?: typeof startProtectedProcess;
  spawn?: typeof spawn;
  signals?: EventEmitter;
  stderr?: (text: string) => unknown;
  platform?: string;
}
export function parseInvocation(
  argv: readonly string[]
): { type: 'run'; command: string; args: string[] } | { type: 'daemon:start' };
export function resolveWorkspace(cwd?: string): Promise<SupervisorWorkspace>;
export function main(
  argv: readonly string[],
  dependencies?: SupervisorDependencies
): Promise<number>;
