// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlState } from "./contract";
import { DirectorConnection, isCompatible } from "./connection";
import { DirectorClient, DirectorCommandError } from "./director-client";
import { render } from "./render";
import { initialState } from "../test/fake-director";
import { controlCommandIds, controlCommandSchema, controlStateSchema } from "./contract";

function capabilities(commands: string[]) {
  return {
    api: 2,
    directorVersion: "test",
    commands,
    services: ["youtubeChat", "chatAgent"] as ("youtubeChat" | "chatAgent")[],
  };
}

describe("DirectorConnection", () => {
  afterEach(() => vi.useRealTimers());

  it("mirrors the strict lights commands and state", () => {
    expect(controlCommandIds).toEqual(expect.arrayContaining([
      "lights.setFlagSync", "lights.setPower", "lights.adjustBrightness", "lights.showFlag",
    ]));
    expect(controlCommandSchema.safeParse({ command: "lights.setFlagSync", args: { enabled: true } }).success).toBe(true);
    expect(controlCommandSchema.safeParse({ command: "lights.setPower", args: { on: false } }).success).toBe(true);
    expect(controlCommandSchema.safeParse({ command: "lights.adjustBrightness", args: { delta: -100 } }).success).toBe(true);
    expect(controlCommandSchema.safeParse({ command: "lights.adjustBrightness", args: { delta: 0 } }).success).toBe(false);
    expect(controlCommandSchema.safeParse({ command: "lights.showFlag", args: { flag: "focus" } }).success).toBe(true);
    expect(controlStateSchema.parse(initialState()).lights).toMatchObject({
      configured: 1,
      reachable: 1,
      flagSync: false,
      manualFlag: null,
      allStop: false,
      power: true,
      brightness: 80,
    });
    expect(controlStateSchema.safeParse({ ...initialState(), lights: { ...initialState().lights, extra: true } }).success).toBe(false);
  });

  it("classifies unsupported APIs and missing commands as incompatible", () => {
    expect(isCompatible({ ...capabilities(["run.start"]), api: 3 })).toBe(false);
    expect(isCompatible(capabilities(["run.start"]))).toBe(false);
    expect(isCompatible({ ...capabilities([...controlCommandIds]), api: 1 })).toBe(false);
    expect(isCompatible(capabilities([...controlCommandIds]))).toBe(true);
  });

  it("shows UPDATE DIRECTOR and does not retry against a Director that still reports api 1", async () => {
    // What a Director up to v0.18.1 answers: api 1, the spectator service and service.restart.
    const legacyCapabilities = {
      api: 1,
      directorVersion: "0.18.1",
      commands: [...controlCommandIds, "service.restart"],
      services: ["youtubeChat", "chatAgent", "spectator"],
    };
    const requested: string[] = [];
    const scheduled: number[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      requested.push(new URL(String(input)).pathname);
      return Response.json(legacyCapabilities);
    }) as typeof fetch;
    const connection = new DirectorConnection({
      schedule: (callback, delay) => {
        scheduled.push(delay);
        return setTimeout(callback, delay);
      },
      makeClient: (url, token) => new DirectorClient(url, token, fetcher),
    });
    connection.configure({ token: "t" });
    await vi.waitFor(() => expect(connection.snapshot().connection).toBe("incompatible"));
    expect(connection.snapshot().state).toBeNull();
    expect(render("connection", connection.snapshot().connection, null).title).toBe("UPDATE\nDIRECTOR");
    expect(requested).toEqual(["/v1/capabilities"]);
    expect(scheduled).toEqual([]);
    await expect(connection.command("run.preflight")).rejects.toThrow("Director is not connected");
    connection.stop();
  });

  it("uses the 1, 2, 5, and 10 second reconnect schedule and hydrates from SSE", async () => {
    vi.useFakeTimers();
    const scheduled: number[] = [];
    let calls = 0;
    const state = initialState();
    const connection = new DirectorConnection({
      schedule: (callback, delay) => {
        scheduled.push(delay);
        return setTimeout(callback, delay);
      },
      makeClient: () => ({
        pair: async () => ({ surfaceId: "s", token: "t" }),
        command: async () => ({ ok: true, detail: "ok", state }),
        capabilities: async () => {
          calls++;
          if (calls <= 4) throw new DirectorCommandError(0, "offline");
          return capabilities([
            "run.preflight", "run.start", "run.pause", "run.resume", "run.stop", "run.allStop",
            "obs.setScene", "obs.setStream", "obs.setRecord", "service.start", "service.stop", "coverage.setFocusWeight", "coverage.adjustFocusWeight",
            "lights.setFlagSync", "lights.setPower", "lights.adjustBrightness", "lights.showFlag",
          ]);
        },
        subscribe: async function* (signal?: AbortSignal) {
          yield state;
          await new Promise<void>(resolve => signal?.addEventListener("abort", () => resolve(), { once: true }));
        },
      }),
    });
    connection.configure({ directorUrl: "http://127.0.0.1:8782", token: "t" });
    await vi.waitFor(() => expect(connection.snapshot().connection).toBe("offline"));
    for (const delay of [1_000, 2_000, 5_000, 10_000]) {
      expect(scheduled.at(-1)).toBe(delay);
      await vi.advanceTimersByTimeAsync(delay);
      if (delay !== 10_000) await vi.waitFor(() => expect(connection.snapshot().connection).toBe("offline"));
    }
    await vi.waitFor(() => expect(connection.snapshot().connection).toBe("connected"));
    expect(connection.snapshot().state?.api).toBe(2);
    expect(connection.snapshot().state).toEqual(state);
    connection.stop();
  });

  it("marks a 401 as unpaired and malformed state as incompatible", async () => {
    const unauthenticated = new DirectorConnection({
      makeClient: () => ({
        pair: async () => ({ surfaceId: "s", token: "t" }),
        command: async () => ({ ok: true, detail: "", state: initialState() }),
        capabilities: async () => { throw new DirectorCommandError(401, "invalid token"); },
        subscribe: async function* () {},
      }),
    });
    unauthenticated.configure({ token: "revoked" });
    await vi.waitFor(() => expect(unauthenticated.snapshot().connection).toBe("unpaired"));

    const invalidState = { ...initialState(), api: 3 } as unknown as ControlState;
    const incompatible = new DirectorConnection({
      makeClient: () => ({
        pair: async () => ({ surfaceId: "s", token: "t" }),
        command: async () => ({ ok: true, detail: "", state: initialState() }),
        capabilities: async () => capabilities([
          "run.preflight", "run.start", "run.pause", "run.resume", "run.stop", "run.allStop",
          "obs.setScene", "obs.setStream", "obs.setRecord", "service.start", "service.stop", "coverage.setFocusWeight", "coverage.adjustFocusWeight",
          "lights.setFlagSync", "lights.setPower", "lights.adjustBrightness", "lights.showFlag",
        ]),
        subscribe: async function* () { yield invalidState; },
      }),
    });
    incompatible.configure({ token: "t" });
    await vi.waitFor(() => expect(incompatible.snapshot().connection).toBe("incompatible"));
  });
});
