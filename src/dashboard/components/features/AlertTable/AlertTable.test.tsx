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
    "Attempted Action / Path Breakout",
    "Enforcement Status",
    "Trigger Signature",
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
    ALERT.triggerSignature,
  ])("renders alert field %s", (fieldValue) => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain(fieldValue);
  });

  it("renders the telemetry empty state", () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain("No security alerts detected.");
  });

  it("does not emit inline styles", () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).not.toContain("style=");
  });
});
