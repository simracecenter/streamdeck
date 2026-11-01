// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { initialState } from "../test/fake-director";
import { render, type ActionId } from "./render";

const ids: ActionId[] = [
  "run-status", "preflight", "start-run", "pause-resume", "stop-run", "all-stop",
  "obs-scene", "obs-stream", "obs-record", "service", "connection",
  "lights-auto", "lights-power", "lights-brightness", "lights-flag",
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

  it("renders focus-weight presets, steps and the live readout", () => {
    const state = initialState();
    expect(render("focus-weight", "connected", state)).toMatchObject({ title: "FOCUS\n50%", state: 0 });
    expect(render("focus-weight", "connected", state, { focusMode: "preset", focusValue: 0.5 })).toMatchObject({ title: "FOCUS\nBALANCED", state: 1, image: "imgs/keys/green" });
    expect(render("focus-weight", "connected", state, { focusMode: "preset", focusValue: 1 })).toMatchObject({ title: "FOCUS\nFULL", state: 0, image: "imgs/keys/grey" });
    expect(render("focus-weight", "connected", state, { focusMode: "preset", focusValue: 0 }).title).toBe("FOCUS\nNATURAL");
    expect(render("focus-weight", "connected", state, { focusMode: "step", focusValue: 0.05 }).title).toBe("FOCUS +5%\n50%");
    expect(render("focus-weight", "connected", state, { focusMode: "step", focusValue: -0.1 }).title).toBe("FOCUS −10%\n50%");
    state.coverage.focusWeight = 1;
    expect(render("focus-weight", "connected", state, { focusMode: "preset", focusValue: 1 }).state).toBe(1);
  });

  it("renders AUTO, power, and brightness status", () => {
    const state = initialState();
    expect(render("lights-auto", "connected", state)).toMatchObject({ title: "AUTO\nOFF", state: 0, image: "imgs/keys/grey" });
    state.lights.flagSync = true;
    state.lights.flag = "yellow";
    expect(render("lights-auto", "connected", state)).toMatchObject({ title: "AUTO\nYELLOW", state: 1, image: "imgs/keys/green" });
    state.lights.allStop = true;
    expect(render("lights-auto", "connected", state)).toMatchObject({ title: "AUTO\nALL STOP", state: 1, image: "imgs/keys/red" });

    expect(render("lights-power", "connected", state)).toMatchObject({ title: "LIGHTS\nON 1/1", state: 1, image: "imgs/keys/green" });
    state.lights.power = false;
    expect(render("lights-power", "connected", state)).toMatchObject({ title: "LIGHTS\nOFF", state: 0, image: "imgs/keys/grey" });
    state.lights.reachable = 0;
    expect(render("lights-power", "connected", state)).toMatchObject({ title: "NO\nLIGHTS", image: "imgs/keys/amber" });
    state.lights.reachable = 1;
    state.lights.configured = 0;
    expect(render("lights-power", "connected", state).title).toBe("NO\nLIGHTS");

    state.lights.configured = 1;
    expect(render("lights-brightness", "connected", state)).toMatchObject({ title: "BRIGHT +10\n80%", state: 0 });
    expect(render("lights-brightness", "connected", state, { lightsDelta: -25 }).title).toBe("BRIGHT −25\n80%");
    state.lights.brightness = null;
    expect(render("lights-brightness", "connected", state, { lightsDelta: 0 }).title).toBe("BRIGHT +10\n—");
  });

  it("renders selected, automatic, incident, and clear manual flags", () => {
    const state = initialState();
    expect(render("lights-flag", "connected", state)).toMatchObject({ title: "GREEN", state: 0, image: "imgs/keys/flag-green-dim" });
    state.lights.manualFlag = "yellow";
    expect(render("lights-flag", "connected", state, { lightsFlag: "yellow" }))
      .toMatchObject({ title: "YELLOW", state: 1, image: "imgs/keys/flag-yellow" });
    state.lights.manualFlag = null;
    state.lights.flagSync = true;
    state.lights.flag = "blue";
    expect(render("lights-flag", "connected", state, { lightsFlag: "blue" }).state).toBe(1);
    state.lights.effect = "focus-incident";
    expect(render("lights-flag", "connected", state, { lightsFlag: "focus" }))
      .toMatchObject({ title: "FOCUS", state: 1, image: "imgs/keys/flag-focus" });
    expect(render("lights-flag", "connected", state, { lightsFlag: "clear" }))
      .toMatchObject({ title: "CLEAR", state: 0, image: "imgs/keys/flag-clear-dim" });
  });

  it.each(["green", "yellow", "blue", "white", "red", "checkered", "debris", "focus"] as const)(
    "renders a held %s flag as lit", flag => {
      const state = initialState();
      state.lights.manualFlag = flag;
      expect(render("lights-flag", "connected", state, { lightsFlag: flag }))
        .toMatchObject({ title: flag.toUpperCase(), state: 1, image: `imgs/keys/flag-${flag}` });
    },
  );
});
