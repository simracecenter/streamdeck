// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlState } from "./contract";
import { DirectorConnection, isCompatible } from "./connection";
import { DirectorCommandError } from "./director-client";
import { initialState } from "../test/fake-director";

function capabilities(commands: string[]) {
  return {
    api: 1,
    directorVersion: "test",
    commands,
    services: ["youtubeChat", "chatAgent", "spectator"] as ("youtubeChat" | "chatAgent" | "spectator")[],
  };
}

describe("DirectorConnection", () => {
  afterEach(() => vi.useRealTimers());

  it("classifies unsupported APIs and missing commands as incompatible", () => {
    expect(isCompatible({ ...capabilities(["run.start"]), api: 2 })).toBe(false);
    expect(isCompatible(capabilities(["run.start"]))).toBe(false);
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
            "obs.setScene", "obs.setStream", "obs.setRecord", "service.start", "service.stop", "service.restart", "coverage.setFocusWeight", "coverage.adjustFocusWeight",
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
    expect(connection.snapshot().state?.api).toBe(1);
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

    const invalidState = { ...initialState(), api: 2 } as unknown as ControlState;
    const incompatible = new DirectorConnection({
      makeClient: () => ({
        pair: async () => ({ surfaceId: "s", token: "t" }),
        command: async () => ({ ok: true, detail: "", state: initialState() }),
        capabilities: async () => capabilities([
          "run.preflight", "run.start", "run.pause", "run.resume", "run.stop", "run.allStop",
          "obs.setScene", "obs.setStream", "obs.setRecord", "service.start", "service.stop", "service.restart", "coverage.setFocusWeight", "coverage.adjustFocusWeight",
        ]),
        subscribe: async function* () { yield invalidState; },
      }),
    });
    incompatible.configure({ token: "t" });
    await vi.waitFor(() => expect(incompatible.snapshot().connection).toBe("incompatible"));
  });
});
