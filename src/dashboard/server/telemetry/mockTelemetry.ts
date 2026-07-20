import type { EnforcementStatus, SecurityAlert, TelemetrySeverity } from '../../types';
import { MOCK_SCENARIO_DURATION_MS } from './constants';

interface MockTemplate {
  readonly action: string;
  readonly id: string;
  readonly offsetMs: number;
  readonly origin: string;
  readonly path: string;
  readonly processName: string;
  readonly severity: TelemetrySeverity;
  readonly status: EnforcementStatus;
  readonly signature: string;
}

const SCENARIOS: readonly (readonly MockTemplate[])[] = [
  [
    {
      action: 'workspace_build_observed',
      id: 'healthy-build',
      offsetMs: 0,
      origin: 'next build',
      path: '/workspace/.next',
      processName: 'next-server',
      severity: 'info',
      status: 'OBSERVED',
      signature: 'WORKSPACE_ACTIVITY_ALLOWED',
    },
    {
      action: 'workspace_test_observed',
      id: 'healthy-test',
      offsetMs: 4_000,
      origin: 'vitest',
      path: '/workspace/src',
      processName: 'vitest',
      severity: 'low',
      status: 'OBSERVED',
      signature: 'WORKSPACE_ACTIVITY_ALLOWED',
    },
  ],
  [
    {
      action: 'credential_access_attempt',
      id: 'credential-probe',
      offsetMs: 0,
      origin: 'Ephemeral Shell Task',
      path: '~/.aws/credentials',
      processName: 'bash',
      severity: 'high',
      status: 'INTERCEPTED',
      signature: 'SENSITIVE_CREDENTIAL_PATH',
    },
  ],
  [
    {
      action: 'workspace_boundary_network_bypass',
      id: 'network-bypass',
      offsetMs: 0,
      origin: 'unvetted-postinstall@0.1.0',
      path: 'https://registry.npmjs.org/unvetted-postinstall',
      processName: 'npm install',
      severity: 'critical',
      status: 'QUARANTINED',
      signature: 'UNVETTED_INSTALL_EGRESS',
    },
  ],
  [
    {
      action: 'package_lifecycle_anomaly',
      id: 'lifecycle-script',
      offsetMs: 0,
      origin: 'postinstall',
      path: '/workspace/node_modules/example/install.js',
      processName: 'node',
      severity: 'high',
      status: 'INTERCEPTED',
      signature: 'PACKAGE_LIFECYCLE_ANOMALY',
    },
  ],
  [
    {
      action: 'unexpected_child_process_chain',
      id: 'child-chain',
      offsetMs: 0,
      origin: 'npm -> sh -> curl',
      path: '/bin/sh',
      processName: 'sh',
      severity: 'critical',
      status: 'INTERCEPTED',
      signature: 'UNEXPECTED_CHILD_CHAIN',
    },
  ],
  [
    {
      action: 'workspace_build_observed',
      id: 'benign-build-burst',
      offsetMs: 0,
      origin: 'next build',
      path: '/workspace/.next',
      processName: 'next-server',
      severity: 'info',
      status: 'OBSERVED',
      signature: 'WORKSPACE_ACTIVITY_ALLOWED',
    },
    {
      action: 'workspace_asset_observed',
      id: 'benign-asset',
      offsetMs: 2_000,
      origin: 'postcss',
      path: '/workspace/public',
      processName: 'node',
      severity: 'low',
      status: 'OBSERVED',
      signature: 'WORKSPACE_ACTIVITY_ALLOWED',
    },
  ],
  [
    {
      action: 'workspace_lint_observed',
      id: 'benign-lint',
      offsetMs: 0,
      origin: 'eslint@9',
      path: '/workspace/src',
      processName: 'eslint',
      severity: 'info',
      status: 'OBSERVED',
      signature: 'WORKSPACE_ACTIVITY_ALLOWED',
    },
    {
      action: 'workspace_test_observed',
      id: 'benign-test',
      offsetMs: 3_000,
      origin: 'vitest',
      path: '/workspace/src',
      processName: 'vitest',
      severity: 'low',
      status: 'OBSERVED',
      signature: 'WORKSPACE_ACTIVITY_ALLOWED',
    },
  ],
  [
    {
      action: 'credential_access_attempt',
      id: 'mixed-warning',
      offsetMs: 0,
      origin: 'setup script',
      path: '~/.ssh/config',
      processName: 'node',
      severity: 'medium',
      status: 'INTERCEPTED',
      signature: 'SENSITIVE_CREDENTIAL_PATH',
    },
    {
      action: 'workspace_test_observed',
      id: 'mixed-healthy',
      offsetMs: 5_000,
      origin: 'npm test',
      path: '/workspace/src',
      processName: 'vitest',
      severity: 'info',
      status: 'OBSERVED',
      signature: 'WORKSPACE_ACTIVITY_ALLOWED',
    },
  ],
] as const;

export function generateMockTelemetryEvents(now = new Date()): SecurityAlert[] {
  const scenarioSlot = Math.floor(now.getTime() / MOCK_SCENARIO_DURATION_MS);
  const scenario = SCENARIOS[scenarioSlot % SCENARIOS.length] ?? [];
  return scenario.map((template, index) => ({
    attemptedAction: template.action,
    attemptedPath: template.path,
    attribution: 'unattributed',
    enforcementStatus: template.status,
    id: `${template.id}-${scenarioSlot}`,
    origin_attribution: template.origin,
    processName: template.processName,
    severity: template.severity,
    targetProcessId: 48_000 + index,
    timestamp: new Date(now.getTime() - template.offsetMs).toISOString(),
    triggerSignature: template.signature,
  }));
}

export { MOCK_SCENARIO_DURATION_MS };
