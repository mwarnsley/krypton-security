import { afterEach, describe, expect, it, test, vi } from "vitest";

const watchdogMocks = vi.hoisted(() => ({
  quarantineProcess: vi.fn(),
}));

vi.mock("../../../../../core/processIsolation.cjs", () => watchdogMocks);

import { POST } from "./route";

const TERMINATE_ENDPOINT = "http://localhost/api/telemetry/terminate";

function createRequest(body: string): Request {
  return new Request(TERMINATE_ENDPOINT, {
    body,
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("telemetry termination route", () => {
  test.each([
    {},
    { targetProcessId: null },
    { targetProcessId: "4242" },
    { targetProcessId: 0 },
    { targetProcessId: -1 },
    { targetProcessId: 1.5 },
    { targetProcessId: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid target process payload %#", async (payload) => {
    const response = await POST(createRequest(JSON.stringify(payload)));

    expect(response.status).toBe(400);
  });

  it("rejects a non-finite target process ID", async () => {
    const response = await POST(
      createRequest('{"targetProcessId":1e10000}'),
    );

    expect(response.status).toBe(400);
  });

  it("describes invalid target process IDs", async () => {
    const response = await POST(
      createRequest('{"targetProcessId":1.5}'),
    );
    const body: unknown = await response.json();

    expect(body).toEqual({
      success: false,
      error: "targetProcessId must be a positive, finite integer.",
    });
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(createRequest("not-json"));

    expect(response.status).toBe(400);
  });

  it("rejects the dashboard server process ID", async () => {
    const response = await POST(
      createRequest(JSON.stringify({ targetProcessId: process.pid })),
    );

    expect(response.status).toBe(400);
  });

  it("does not quarantine the dashboard server process", async () => {
    await POST(
      createRequest(JSON.stringify({ targetProcessId: process.pid })),
    );

    expect(watchdogMocks.quarantineProcess).not.toHaveBeenCalled();
  });

  it("rejects an unregistered workspace process", async () => {
    watchdogMocks.quarantineProcess.mockImplementationOnce(() => {
      throw new Error("The process ID is not registered to this workspace.");
    });

    const response = await POST(
      createRequest(JSON.stringify({ targetProcessId: 4242 })),
    );

    expect(response.status).toBe(400);
  });

  it("returns status 500 when quarantine fails", async () => {
    watchdogMocks.quarantineProcess.mockImplementationOnce(() => {
      throw new Error("signal dispatch failed");
    });

    const response = await POST(
      createRequest(JSON.stringify({ targetProcessId: 4242 })),
    );

    expect(response.status).toBe(500);
  });

  it("quarantines a registered workspace process", async () => {
    await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));

    expect(watchdogMocks.quarantineProcess).toHaveBeenCalledWith(
      4242,
      "./sandbox_workspace/.aegisagent/manual-containment",
    );
  });

  it("returns the isolated PID after quarantine", async () => {
    const response = await POST(
      createRequest(JSON.stringify({ targetProcessId: 4242 })),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, isolatedPid: 4242 });
  });
});
