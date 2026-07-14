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
let workspaceEventHandler:
  | ((eventType: string, filename: string | null) => void)
  | undefined;
let workspaceErrorHandler: ((error: Error) => void) | undefined;
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
const watcherCloseMock = vi.fn();
const workspaceWatcherStub = {
  close: watcherCloseMock,
  on: vi.fn((eventName: string, listener: (error: Error) => void) => {
    if (eventName === "error") {
      workspaceErrorHandler = listener;
    }

    return workspaceWatcherStub;
  }),
} as unknown as fs.FSWatcher;

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
  watcherCloseMock.mockClear();
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
      watchdog.registerWorkspaceProcess(42_424);
      watchdog.quarantineProcess(42_424, ILLEGAL_PATH);

      expect(processKillSpy).toHaveBeenCalledWith(42_424, "SIGKILL");
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it("queues one alert without writing to the live filesystem", () => {
    const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    try {
      watchdog.registerWorkspaceProcess(42_425);
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

  test.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid process registration %s",
    (pid) => {
      expect(() => watchdog.registerWorkspaceProcess(pid)).toThrow(RangeError);
    },
  );

  it("registers a valid owned process ID without throwing", () => {
    try {
      expect(() => watchdog.registerWorkspaceProcess(42_429)).not.toThrow();
    } finally {
      watchdog.unregisterWorkspaceProcess(42_429);
    }
  });

  it("handles duplicate process registration without throwing", () => {
    try {
      watchdog.registerWorkspaceProcess(42_430);

      expect(() => watchdog.registerWorkspaceProcess(42_430)).not.toThrow();
    } finally {
      watchdog.unregisterWorkspaceProcess(42_430);
    }
  });

  it("rejects quarantine for an unregistered process ID", () => {
    const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    try {
      expect(() => watchdog.quarantineProcess(42_427, ILLEGAL_PATH)).toThrow(
        "The process ID is not registered to this workspace.",
      );
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it("removes a normally exited process from quarantine tracking", () => {
    const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    try {
      watchdog.registerWorkspaceProcess(42_428);
      watchdog.unregisterWorkspaceProcess(42_428);

      expect(() => watchdog.quarantineProcess(42_428, ILLEGAL_PATH)).toThrow(
        "The process ID is not registered to this workspace.",
      );
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it("propagates process termination failures", () => {
    const processKillSpy = vi
      .spyOn(process, "kill")
      .mockImplementation(() => {
        throw new Error("simulated termination failure");
      });

    try {
      watchdog.registerWorkspaceProcess(42_426);

      expect(() =>
        watchdog.quarantineProcess(42_426, ILLEGAL_PATH),
      ).toThrow("simulated termination failure");
    } finally {
      processKillSpy.mockRestore();
    }
  });

  describe("workspace watcher", () => {
    it("starts one persistent recursive watcher for the sandbox", () => {
      const watchSpy = vi
        .spyOn(fs, "watch")
        .mockReturnValue(workspaceWatcherStub);

      try {
        watchdog.startWorkspaceWatcher(SANDBOX_ROOT);
        const watchCall = watchSpy.mock.calls[0] as unknown as [
          string,
          fs.WatchOptions,
          (eventType: string, filename: string | null) => void,
        ];
        workspaceEventHandler = watchCall[2];

        expect(watchSpy).toHaveBeenCalledWith(
          SANDBOX_ROOT,
          {
            encoding: "utf8",
            persistent: true,
            recursive: true,
          },
          expect.any(Function),
        );
      } finally {
        watchSpy.mockRestore();
      }
    });

    it("does not create a duplicate watcher for the sandbox", () => {
      const watchSpy = vi
        .spyOn(fs, "watch")
        .mockReturnValue(workspaceWatcherStub);

      try {
        watchdog.startWorkspaceWatcher(SANDBOX_ROOT);

        expect(watchSpy).not.toHaveBeenCalled();
      } finally {
        watchSpy.mockRestore();
      }
    });

    it("rejects a watcher path outside the sandbox", () => {
      expect(() => watchdog.startWorkspaceWatcher("../other-workspace")).toThrow(
        RangeError,
      );
    });

    it("handles a valid change event without a runtime exception", () => {
      const eventHandler = workspaceEventHandler;
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      if (eventHandler === undefined) {
        throw new Error("The mocked workspace event handler was not captured.");
      }

      try {
        expect(() => eventHandler("change", "updated-ticket.txt")).not.toThrow();
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it("handles a valid rename event without a runtime exception", () => {
      const eventHandler = workspaceEventHandler;
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      if (eventHandler === undefined) {
        throw new Error("The mocked workspace event handler was not captured.");
      }

      try {
        expect(() => eventHandler("rename", "renamed-ticket.txt")).not.toThrow();
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it("dispatches rapid valid events without quarantining a process", () => {
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      try {
        for (let index = 0; index < 1_000; index += 1) {
          workspaceEventHandler?.("change", `burst-${String(index)}.txt`);
        }

        expect(processKillSpy).not.toHaveBeenCalled();
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it("quarantines a registered process for a sensitive file event", () => {
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      try {
        watchdog.registerWorkspaceProcess(52_001);
        workspaceEventHandler?.("change", ".env");

        expect(processKillSpy).toHaveBeenCalledWith(52_001, "SIGKILL");
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it("quarantines a registered process for a traversal rename event", () => {
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      try {
        watchdog.registerWorkspaceProcess(52_002);
        workspaceEventHandler?.("rename", "../.ssh/id_rsa");

        expect(processKillSpy).toHaveBeenCalledWith(52_002, "SIGKILL");
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it("quarantines each duplicate registration only once", () => {
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      try {
        watchdog.registerWorkspaceProcess(52_003);
        watchdog.registerWorkspaceProcess(52_003);
        workspaceEventHandler?.("change", ".aws");

        expect(processKillSpy).toHaveBeenCalledTimes(1);
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it("fails closed when an event omits its filename", () => {
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      try {
        watchdog.registerWorkspaceProcess(52_004);
        workspaceEventHandler?.("change", null);

        expect(processKillSpy).toHaveBeenCalledWith(52_004, "SIGKILL");
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it("ignores unsupported native event labels", () => {
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      try {
        workspaceEventHandler?.("unsupported", ".env");

        expect(processKillSpy).not.toHaveBeenCalled();
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it("quarantines tracked processes when the watcher emits an error", () => {
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);

      try {
        watchdog.registerWorkspaceProcess(52_005);
        workspaceErrorHandler?.(new Error("simulated watcher failure"));

        expect(processKillSpy).toHaveBeenCalledWith(52_005, "SIGKILL");
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it("quarantines and rethrows watcher initialization failures", () => {
      const processKillSpy = vi.spyOn(process, "kill").mockReturnValue(true);
      const watchSpy = vi.spyOn(fs, "watch").mockImplementation(() => {
        throw new Error("simulated watcher initialization failure");
      });

      try {
        watchdog.registerWorkspaceProcess(52_006);

        expect(() => watchdog.startWorkspaceWatcher(SANDBOX_ROOT)).toThrow(
          "simulated watcher initialization failure",
        );
      } finally {
        watchSpy.mockRestore();
        processKillSpy.mockRestore();
      }
    });
  });
});
