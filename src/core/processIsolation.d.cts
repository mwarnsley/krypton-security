export interface ProcessIdentityPayload {
  executablePath: string;
  parentPid: number | null;
  pid: number;
  startTime: number;
}

export interface ProtectedChildLifecycle {
  kill(signal?: NodeJS.Signals): unknown;
  once(event: string, listener: (...args: unknown[]) => void): this;
  pid?: number;
}

export function dispatchNativeControl(command: Record<string, unknown>): Promise<Record<string, unknown>>;
export function getActiveWorkspaceProcessCount(): number;
export function inspectProcessIdentity(pid: number): Promise<ProcessIdentityPayload>;

export function quarantineProcess(pid: number, illegalPath: string): void;

export function quarantineRegisteredProcesses(illegalPath: string): void;

export function registerWorkspaceProcess(pid: number): void;
export function spawnProtectedProcess(
  command: string,
  args?: readonly string[],
  options?: import('node:child_process').SpawnOptions & { maxRuntimeMs?: number },
  dependencies?: {
    spawn?: (
      command: string,
      args: readonly string[],
      options: import('node:child_process').SpawnOptions
    ) => ProtectedChildLifecycle;
    inspect?: (pid: number) => Promise<ProcessIdentityPayload>;
    dispatch?: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }
): Promise<import('node:child_process').ChildProcess>;

export function unregisterWorkspaceProcess(pid: number): void;
