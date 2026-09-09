/** Runs the disposable native checks; failures propagate to the CLI error boundary. */
export function runE2E(
  run?: () => Promise<void>,
  report?: (message: string) => void
): Promise<number>;
