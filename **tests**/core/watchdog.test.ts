import fs = require("node:fs");
import path = require("node:path");
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
  vi,
} from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SANDBOX_ROOT = path.resolve(PROJECT_ROOT, "sandbox_workspace");
const ILLEGAL_PATH = path.resolve(PROJECT_ROOT, ".ssh", "id_rsa");

let alertErrorHandler:
  | ((error: NodeJS.ErrnoException) => void)
  | undefined;
const alertWriteMock = vi.fn(() => true);
const alertStreamStub = {
  on: vi.fn(
    (
      eventName: string,
      listener: (error: NodeJS.ErrnoException) => void,
    ) => {
      if (eventName === "error") {
        alertErrorHandler = listener;
      }

      return alertStreamStub;
    },
  ),
  write: alertWriteMock,
} as unknown as fs.WriteStream;

let watchdog: typeof import("../../src/core/watchdog.js");

beforeAll(async () => {
  const createWriteStreamSpy = vi
    .spyOn(fs, "createWriteStream")
    .mockReturnValue(alertStreamStub);

  watchdog = await import("../../src/core/watchdog.js");
  createWriteStreamSpy.mockRestore();
});

beforeEach(() => {
  alertWriteMock.mockClear();
});

describe("watchdog core engine", () => {
  test.each([
    {
      condition: "allows a valid path inside the sandbox",
      expected: true,
      targetPath: path.resolve(SANDBOX_ROOT, "valid-ticket.txt"),
    },
    {
      condition: "allows the sandbox root",
      expected: true,
      targetPath: SANDBOX_ROOT,
    },
    {
      condition: "blocks an explicit out-of-bounds traversal",
      expected: false,
      targetPath: "../.ssh/id_rsa",
    },
    {
      condition: "blocks a sensitive environment target inside the sandbox",
      expected: false,
      targetPath: path.resolve(SANDBOX_ROOT, ".env"),
    },
    {
      condition: "blocks an environment variant inside the sandbox",
      expected: false,
      targetPath: path.resolve(SANDBOX_ROOT, ".env.production"),
    },
    {
      condition: "blocks a case-insensitive SSH target inside the sandbox",
      expected: false,
      targetPath: path.resolve(SANDBOX_ROOT, ".SSH", "id_rsa"),
    },
    {
      condition: "blocks an empty path token",
      expected: false,
      targetPath: "",
    },
  ])("$condition", ({ expected, targetPath }) => {
    expect(watchdog.verifyPathAccess(targetPath)).toBe(expected);
  });

  it("fails closed when path resolution receives an invalid runtime token", () => {
    expect(
      watchdog.verifyPathAccess(null as unknown as string),
    ).toBe(false);
  });

  it("propagates alert stream failures", () => {
    const streamError = new Error("simulated stream failure");

    expect(() => alertErrorHandler?.(streamError)).toThrow(streamError);
  });

  it("signals the precise owned process ID with SIGKILL", () => {
    const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    try {
      watchdog.quarantineProcess(42_424, ILLEGAL_PATH);

      expect(processKillSpy).toHaveBeenCalledWith(42_424, "SIGKILL");
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it("queues one alert without writing to the live filesystem", () => {
    const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    try {
      watchdog.quarantineProcess(42_425, ILLEGAL_PATH);

      expect(alertWriteMock).toHaveBeenCalledTimes(1);
    } finally {
      processKillSpy.mockRestore();
    }
  });

  test.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid process ID %s",
    (pid) => {
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      try {
        expect(() => watchdog.quarantineProcess(pid, ILLEGAL_PATH)).toThrow(
          RangeError,
        );
      } finally {
        processKillSpy.mockRestore();
      }
    },
  );

  it("propagates process termination failures", () => {
    const processKillSpy = vi
      .spyOn(process, "kill")
      .mockImplementation(() => {
        throw new Error("simulated termination failure");
      });

    try {
      expect(() =>
        watchdog.quarantineProcess(42_426, ILLEGAL_PATH),
      ).toThrow("simulated termination failure");
    } finally {
      processKillSpy.mockRestore();
    }
  });
});
