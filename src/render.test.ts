// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { initialState } from "../test/fake-director";
import { render, type ActionId } from "./render";

const ids: ActionId[] = [
  "run-status", "preflight", "start-run", "pause-resume", "stop-run", "all-stop",
  "obs-scene", "obs-stream", "obs-record", "service", "connection",
];

describe("render", () => {
  it.each(["unconfigured", "unpaired", "connecting", "offline", "incompatible"] as const)(
    "renders a non-connected title for every action (%s)", connection => {
      for (const id of ids) {
        const title = render(id, connection, null).title;
        expect(title).toBe(connection === "incompatible" ? "UPDATE\nDIRECTOR" :
          connection === "unconfigured" || connection === "unpaired" ? "PAIR" : "OFFLINE");
      }
    },
  );

  it("maps run, OBS, service, and connection states", () => {
    const state = initialState();
    expect(render("run-status", "connected", state).title).toBe("IDLE");
    state.run.preflightCurrent = true;
    state.run.lastPreflightOk = true;
    state.run.admit = true;
    expect(render("run-status", "connected", state).title).toBe("PREFLT OK");
    expect(render("start-run", "connected", state).title).toBe("START");
    state.run.live = true;
    expect(render("run-status", "connected", state).title).toBe("LIVE");
    expect(render("pause-resume", "connected", state)).toMatchObject({ title: "PAUSE", state: 0 });
    state.run.paused = true;
    expect(render("pause-resume", "connected", state)).toMatchObject({ title: "RESUME", state: 1 });
    state.run.held = true;
    expect(render("run-status", "connected", state).title).toBe("HELD");
    expect(render("all-stop", "connected", state).title).toBe("HELD");
    expect(render("stop-run", "connected", state).title).toBe("STOP");
    expect(render("preflight", "connected", state).title).toBe("PREFLT OK");
    expect(render("obs-scene", "connected", state, { scene: "Grid" }).image).toBe("imgs/keys/green");
    expect(render("obs-stream", "connected", state)).toMatchObject({ title: "STREAM\nOFF", state: 0 });
    expect(render("obs-record", "connected", state)).toMatchObject({ title: "RECORD\nOFF", state: 0 });
    expect(render("service", "connected", state, { serviceId: "spectator" }).title).toContain("SPECTATOR");
    expect(render("connection", "connected", state).title).toBe("CONNECTED");
    state.obs.streaming = null;
    state.obs.recording = null;
    expect(render("obs-stream", "connected", state).title).toBe("OBS ?");
    expect(render("obs-record", "connected", state).title).toBe("OBS ?");
  });

  it("resolves scene slots and prefers explicit scenes", () => {
    const state = initialState();
    expect(render("obs-scene", "connected", state, { slot: 1 }))
      .toMatchObject({ title: "Grid", image: "imgs/keys/green" });
    expect(render("obs-scene", "connected", state, { slot: 2 }))
      .toMatchObject({ title: "Replay", image: "imgs/keys/grey" });
    expect(render("obs-scene", "connected", state, { scene: "Podium", slot: 1 }))
      .toMatchObject({ title: "Podium", image: "imgs/keys/grey" });
    expect(render("obs-scene", "connected", state, { slot: 4 }))
      .toMatchObject({ title: "SCENE 4\n—", image: "imgs/keys/grey" });
  });

  it("shows the preflight warning but does not suppress start", () => {
    expect(render("start-run", "connected", initialState()).title).toBe("NEEDS\nPREFLT");
  });
});
