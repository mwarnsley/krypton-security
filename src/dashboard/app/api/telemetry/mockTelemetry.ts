import type { SecurityAlert } from '../../../types';

const MOCK_EVENT_OFFSETS_MS = [0, 18_000, 43_000, 76_000] as const;

/**
 * Generates a rotating, table-compatible telemetry snapshot for daemon outages.
 *
 * @param {Date} capturedAt - The timestamp used to anchor the newest mock event.
 * @returns {SecurityAlert[]} A newest-first mixture of hostile and healthy workspace events.
 * @complexity O(1) time and space because the fallback snapshot has a fixed event count.
 * @example
 * generateMockTelemetryEvents(new Date('2026-07-19T12:00:00.000Z'));
 * // => four table-compatible security events
 */
export function generateMockTelemetryEvents(capturedAt = new Date()): SecurityAlert[] {
  const timestamps = MOCK_EVENT_OFFSETS_MS.map((offset) =>
    new Date(capturedAt.getTime() - offset).toISOString()
  );

  return [
    {
      attemptedAction: 'credential_access_attempt',
      attemptedPath: '~/.aws/credentials',
      enforcementStatus: 'INTERCEPTED',
      id: 'mock-zero-day-aws-credentials',
      origin_attribution: 'Ephemeral Shell Task',
      processName: 'bash',
      severity: 'high',
      targetProcessId: 48_217,
      timestamp: timestamps[0],
      triggerSignature: 'SENSITIVE_CREDENTIAL_PATH',
    },
    {
      attemptedAction: 'workspace_boundary_network_bypass',
      attemptedPath: 'https://registry.npmjs.org/unvetted-postinstall',
      enforcementStatus: 'QUARANTINED',
      id: 'mock-npm-install-network-bypass',
      origin_attribution: 'unvetted-postinstall@0.1.0',
      processName: 'npm install',
      severity: 'critical',
      targetProcessId: 48_193,
      timestamp: timestamps[1],
      triggerSignature: 'UNVETTED_INSTALL_EGRESS',
    },
    {
      attemptedAction: 'workspace_lint_observed',
      attemptedPath: '/workspace/src',
      enforcementStatus: 'OBSERVED',
      id: 'mock-eslint-healthy-scan',
      origin_attribution: 'eslint@9 workspace task',
      processName: 'eslint',
      severity: 'info',
      targetProcessId: 48_141,
      timestamp: timestamps[2],
      triggerSignature: 'WORKSPACE_ACTIVITY_ALLOWED',
    },
    {
      attemptedAction: 'workspace_build_observed',
      attemptedPath: '/workspace/.next',
      enforcementStatus: 'OBSERVED',
      id: 'mock-next-build-healthy-output',
      origin_attribution: 'next build',
      processName: 'next-server',
      severity: 'low',
      targetProcessId: 48_102,
      timestamp: timestamps[3],
      triggerSignature: 'WORKSPACE_ACTIVITY_ALLOWED',
    },
  ];
}
