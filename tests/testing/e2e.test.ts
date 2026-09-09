import { describe, expect, it, vi } from 'vitest';
import { runE2E } from '../../src/testing/e2e.cjs';

describe('E2E command reporting', () => {
  it('reports success only after the disposable simulation completes', async () => {
    const report = vi.fn();
    const run = vi.fn(async () => {
      expect(report).not.toHaveBeenCalled();
    });
    expect(await runE2E(run, report)).toBe(0);
    expect(report).toHaveBeenCalledWith('[PASS] Local E2E containment verification complete.');
  });

  it('propagates simulation failures to the shared CLI error boundary', async () => {
    const failure = new Error('fixture failed');
    const report = vi.fn();
    await expect(
      runE2E(async () => {
        throw failure;
      }, report)
    ).rejects.toBe(failure);
    expect(report).not.toHaveBeenCalled();
  });
});
