import { describe, expect, it, test } from "vitest";

import {
  getActiveWorkspaceProcessCount,
  registerWorkspaceProcess,
  unregisterWorkspaceProcess,
} from "../../src/core/processIsolation.cjs";

describe("process isolation registry", () => {
  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid process ID %s",
    (pid) => {
      expect(() => registerWorkspaceProcess(pid)).toThrow(RangeError);
    },
  );

  it("registers and unregisters a valid process ID", () => {
    registerWorkspaceProcess(61_001);

    expect(() => unregisterWorkspaceProcess(61_001)).not.toThrow();
  });

  it("handles duplicate process registration idempotently", () => {
    try {
      registerWorkspaceProcess(61_002);

      expect(() => registerWorkspaceProcess(61_002)).not.toThrow();
    } finally {
      unregisterWorkspaceProcess(61_002);
    }
  });

  it("reports the live number of registered process IDs", () => {
    try {
      registerWorkspaceProcess(61_003);

      expect(getActiveWorkspaceProcessCount()).toBe(1);
    } finally {
      unregisterWorkspaceProcess(61_003);
    }
  });
});
