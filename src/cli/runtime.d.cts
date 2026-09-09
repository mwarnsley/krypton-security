/** Terminal failures resolve with a nonzero process.exitCode and never reject. */
export function runCli(
  main: (argv: string[]) => Promise<number>,
  argv?: string[],
  onFailure?: () => void
): Promise<void>;
