import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it, test, vi } from 'vitest';

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock('node:child_process', () => childProcessMocks);

import {
  attestProcessOrigin,
  deriveFallbackOriginAttribution,
  EPHEMERAL_ORIGIN_ATTRIBUTION,
  extractOriginAttribution,
  lookupParentProcessId,
  lookupProcessCommand,
} from './processAttestation';

afterEach(() => {
  vi.clearAllMocks();
});

describe('process attestation', () => {
  test.each([
    [
      '/usr/bin/node /workspace/node_modules/malicious-package-xyz/index.js',
      'malicious-package-xyz',
    ],
    [
      '/usr/bin/node /workspace/node_modules/@scope/dependency-name/dist/cli.js',
      '@scope/dependency-name',
    ],
    ['/usr/bin/node /workspace/node_modules/.pnpm/tool@1.0.0/node_modules/tool/index.js', 'tool'],
  ])('extracts dependency attribution from %s', (command, expectedAttribution) => {
    expect(extractOriginAttribution(command, '/workspace')).toBe(expectedAttribution);
  });

  test.each([
    ['/bin/bash /workspace/scripts/setup.sh', 'scripts/setup.sh'],
    ['/usr/bin/node ./scripts/bootstrap.ts', 'scripts/bootstrap.ts'],
    ['/usr/bin/python3 "tools/security scan.py"', 'tools/security scan.py'],
  ])('extracts local script attribution from %s', (command, expectedAttribution) => {
    expect(extractOriginAttribution(command, '/workspace')).toBe(expectedAttribution);
  });

  it('uses the known shell runner without claiming an external script path', () => {
    expect(extractOriginAttribution('/bin/bash /tmp/external.sh', '/workspace')).toBe(
      'Local Script Task: bash'
    );
  });

  it('returns the ephemeral fallback for an unrecognized system command', () => {
    expect(extractOriginAttribution('/usr/sbin/cron -f', '/workspace')).toBe(
      EPHEMERAL_ORIGIN_ATTRIBUTION
    );
  });

  it('labels a local shell runner when no script argument survives', () => {
    expect(extractOriginAttribution('/bin/zsh -l', '/workspace')).toBe('Local Script Task: zsh');
  });

  it('derives a completed script from a local alert path', () => {
    expect(deriveFallbackOriginAttribution('/workspace/scripts/setup.sh', '/workspace')).toBe(
      'Completed Script Process: scripts/setup.sh'
    );
  });

  it('does not claim a completed script outside the repository', () => {
    expect(deriveFallbackOriginAttribution('/tmp/external.sh', '/workspace')).toBe(
      EPHEMERAL_ORIGIN_ATTRIBUTION
    );
  });

  it('executes the fixed ps process lookup without shell interpolation', async () => {
    childProcessMocks.execFile.mockImplementationOnce((_file, _arguments, _options, callback) => {
      callback(null, '/usr/bin/node /workspace/scripts/agent.js\n');
    });

    await expect(lookupProcessCommand(4242)).resolves.toBe(
      '/usr/bin/node /workspace/scripts/agent.js'
    );
    expect(execFile).toHaveBeenCalledWith(
      'ps',
      ['-p', '4242', '-o', 'command='],
      expect.objectContaining({ encoding: 'utf8', timeout: 500 }),
      expect.any(Function)
    );
  });

  it('returns undefined when ps cannot find the process', async () => {
    childProcessMocks.execFile.mockImplementationOnce((_file, _arguments, _options, callback) => {
      callback(new Error('process missing'), '');
    });

    await expect(lookupProcessCommand(4242)).resolves.toBeUndefined();
  });

  it('queries the process parent signature with a bounded ps lookup', async () => {
    childProcessMocks.execFile.mockImplementationOnce((_file, _arguments, _options, callback) => {
      callback(null, '4100\n');
    });

    await expect(lookupParentProcessId(4242)).resolves.toBe(4100);
    expect(execFile).toHaveBeenCalledWith(
      'ps',
      ['-o', 'ppid=', '-p', '4242'],
      expect.objectContaining({ encoding: 'utf8', timeout: 500 }),
      expect.any(Function)
    );
  });

  it('uses local alert context for an invalid or completed process ID', async () => {
    const commandLookup = vi.fn();
    const parentProcessIdLookup = vi.fn();

    await expect(
      attestProcessOrigin(
        -1,
        { attemptedPath: '/workspace/scripts/setup.sh', projectRoot: '/workspace' },
        { commandLookup, parentProcessIdLookup }
      )
    ).resolves.toBe('Completed Script Process: scripts/setup.sh');
    expect(commandLookup).not.toHaveBeenCalled();
    expect(parentProcessIdLookup).not.toHaveBeenCalled();
  });

  it('reads the live parent command when the target command has disappeared', async () => {
    const commandLookup = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('/bin/bash');
    const parentProcessIdLookup = vi.fn().mockResolvedValue(4100);

    await expect(
      attestProcessOrigin(
        4242,
        { projectRoot: '/workspace' },
        { commandLookup, parentProcessIdLookup }
      )
    ).resolves.toBe('Local Script Task: bash');
    expect(commandLookup).toHaveBeenNthCalledWith(2, 4100);
  });

  it('returns completed-script context after both process lookups miss', async () => {
    const commandLookup = vi.fn().mockResolvedValue(undefined);
    const parentProcessIdLookup = vi.fn().mockResolvedValue(undefined);

    await expect(
      attestProcessOrigin(
        4242,
        { attemptedPath: '/workspace/scripts/setup.sh', projectRoot: '/workspace' },
        { commandLookup, parentProcessIdLookup }
      )
    ).resolves.toBe('Completed Script Process: scripts/setup.sh');
  });

  it('continues to the parent signature when the direct command lookup rejects', async () => {
    const commandLookup = vi
      .fn()
      .mockRejectedValueOnce(new Error('lookup failed'))
      .mockResolvedValueOnce('/bin/zsh');
    const parentProcessIdLookup = vi.fn().mockResolvedValue(4100);

    await expect(
      attestProcessOrigin(4242, {}, { commandLookup, parentProcessIdLookup })
    ).resolves.toBe('Local Script Task: zsh');
  });

  it('returns the ephemeral fallback when direct and parent lookups fail', async () => {
    const commandLookup = vi.fn().mockRejectedValue(new Error('lookup failed'));
    const parentProcessIdLookup = vi.fn().mockRejectedValue(new Error('parent lookup failed'));

    await expect(
      attestProcessOrigin(4242, {}, { commandLookup, parentProcessIdLookup })
    ).resolves.toBe(EPHEMERAL_ORIGIN_ATTRIBUTION);
  });
});
