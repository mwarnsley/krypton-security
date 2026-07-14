import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, test } from "vitest";

import { AlertTable, type SecurityAlert } from "./AlertTable";

const ALERT: SecurityAlert = {
  attemptedAction: "READ_FILE",
  attemptedPath: "/project/.ssh/id_rsa",
  enforcementStatus: "QUARANTINED",
  id: "alert-1",
  targetProcessId: 4242,
  timestamp: "2026-07-14T12:00:00.000Z",
  triggerSignature: "PATH_BOUNDARY_ESCAPE",
};

describe("AlertTable", () => {
  test.each([
    "Timestamp",
    "Target Process ID",
    "Attempted Action",
    "Enforcement Status",
    "Actions",
  ])("renders the %s column", (columnLabel) => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain(columnLabel);
  });

  test.each([
    ALERT.timestamp,
    String(ALERT.targetProcessId),
    ALERT.attemptedAction,
    ALERT.attemptedPath,
    ALERT.enforcementStatus,
  ])("renders alert field %s", (fieldValue) => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain(fieldValue);
  });

  it("renders the telemetry empty state", () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain("No security alerts detected.");
  });

  it("renders the per-process Force Isolate action", () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain("Force Isolate");
  });

  it("provides an accessible process-specific isolation label", () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('aria-label="Force isolate process 4242"');
  });

  it("renders quarantined alerts with the crimson treatment", () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain("bg-rose-500/10");
  });

  it("does not emit inline styles", () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).not.toContain("style=");
  });
});
