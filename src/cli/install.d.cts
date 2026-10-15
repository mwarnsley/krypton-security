import type { SetupOptions } from './setup.cjs';

export interface InstallOptions extends SetupOptions {
  /** Bounded notification boundary; failures preserve completed settings writes. */
  notify?: () => Promise<void>;
}
export function notifySetupComplete(): Promise<void>;
export function main(argv?: string[], options?: InstallOptions): Promise<number>;
