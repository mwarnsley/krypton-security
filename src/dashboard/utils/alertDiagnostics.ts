import type { SecurityAlert } from '../types';

export type DiagnosticFailure =
  'serialization_failed' | 'clipboard_unavailable' | 'clipboard_failed' | 'download_failed';
export type DiagnosticResult<T = undefined> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: DiagnosticFailure };

/** Whitelist retained event fields; transport capabilities and arbitrary properties never enter exports. */
export function serializeDiagnosticEvent(alert: SecurityAlert): DiagnosticResult<string> {
  try {
    const process = alert.process;
    return {
      ok: true,
      value: JSON.stringify(
        {
          id: alert.id,
          timestamp: alert.timestamp,
          attribution: alert.attribution,
          targetProcessId: alert.targetProcessId,
          processName: alert.processName,
          process: process
            ? {
                pid: process.pid,
                parentPid: process.parentPid,
                executablePath: process.executablePath,
                startTime: process.startTime,
              }
            : null,
          attemptedAction: alert.attemptedAction,
          attemptedPath: alert.attemptedPath,
          enforcementStatus: alert.enforcementStatus,
          severity: alert.severity,
          triggerSignature: alert.triggerSignature,
          origin_attribution: alert.origin_attribution,
          ...(alert.sequence === undefined ? {} : { sequence: alert.sequence }),
        },
        null,
        2
      ),
    };
  } catch (error: unknown) {
    void error;
    return { ok: false, code: 'serialization_failed' };
  }
}

/** Copies available process facts, preserving unknown identity/parent fields as null. */
export async function copyProcessDetails(alert: SecurityAlert): Promise<DiagnosticResult> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function')
      return { ok: false, code: 'clipboard_unavailable' };
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          pid: alert.process?.pid ?? alert.targetProcessId,
          executablePath: alert.process?.executablePath ?? null,
          applicationOrTool: alert.processName,
          parentPid: alert.process?.parentPid ?? null,
          startTime: alert.process?.startTime ?? null,
          attribution: alert.attribution,
        },
        null,
        2
      )
    );
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    void error;
    return { ok: false, code: 'clipboard_failed' };
  }
}

/** O(L) unsigned Markdown serialization. Indented JSON prevents telemetry from introducing Markdown links/headings. */
export function createThreatReport(
  alert: SecurityAlert,
  protectedWorkspaceRoot?: string
): DiagnosticResult<{ readonly content: string; readonly filename: string }> {
  const event = serializeDiagnosticEvent(alert);
  if (!event.ok) return event;
  try {
    const folder = JSON.stringify(
      { currentProtectedWorkspaceRoot: protectedWorkspaceRoot ?? null },
      null,
      2
    );
    return {
      ok: true,
      value: {
        filename: `krypton_threat_report_${alert.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'event'}.md`,
        content:
          '# Krypton Threat Report\n\nUnsigned diagnostic export. No cryptographic signature or proof of publisher identity is attached.\n\n## Retained dashboard event\n\n' +
          event.value
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n') +
          '\n\n## Current connected runtime folder\n\n' +
          folder
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n') +
          '\n\nThe folder is current runtime metadata, not a historical event snapshot. Observations and simulated events are not proof of process isolation.\n',
      },
    };
  } catch (error: unknown) {
    void error;
    return { ok: false, code: 'serialization_failed' };
  }
}

/** Browser-only download with owned-link/object-URL cleanup and redacted failure results. */
export function downloadThreatReport(
  alert: SecurityAlert,
  protectedWorkspaceRoot?: string
): DiagnosticResult {
  const report = createThreatReport(alert, protectedWorkspaceRoot);
  if (!report.ok) return report;
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  let failed = false;
  try {
    url = URL.createObjectURL(
      new Blob([report.value.content], { type: 'text/markdown;charset=utf-8' })
    );
    anchor = document.createElement('a');
    anchor.download = report.value.filename;
    anchor.href = url;
    document.body.append(anchor);
    anchor.click();
  } catch (error: unknown) {
    void error;
    failed = true;
  } finally {
    try {
      anchor?.remove();
    } catch (error: unknown) {
      void error;
      failed = true;
    }
    try {
      if (url !== undefined) URL.revokeObjectURL(url);
    } catch (error: unknown) {
      void error;
      failed = true;
    }
  }
  return failed ? { ok: false, code: 'download_failed' } : { ok: true, value: undefined };
}

/** Display-only validation; enforcement never consumes this browser metadata. */
export function normalizeProtectedWorkspaceRoot(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.length > 1024 ||
    /[\p{Cc}\p{Cs}]/u.test(value)
  )
    return undefined;
  try {
    return new Blob([value]).size <= 1024 ? value : undefined;
  } catch (error: unknown) {
    void error;
    return undefined;
  }
}
