// SPDX-License-Identifier: GPL-3.0-or-later
import type { ConnectionStatus } from "./connection";
import type { ControlState } from "./contract";

export type ActionId =
  | "run-status"
  | "preflight"
  | "start-run"
  | "pause-resume"
  | "stop-run"
  | "all-stop"
  | "obs-scene"
  | "obs-stream"
  | "obs-record"
  | "service"
  | "connection";

export type ActionSettings = { scene?: string; serviceId?: string };
export interface RenderedAction {
  title: string;
  state: 0 | 1;
  image?: string;
}

const images = {
  grey: "imgs/keys/grey",
  green: "imgs/keys/green",
  amber: "imgs/keys/amber",
  red: "imgs/keys/red",
} as const;

export function render(
  action: ActionId,
  connection: ConnectionStatus,
  state: ControlState | null,
  settings: ActionSettings = {},
): RenderedAction {
  if (connection !== "connected") {
    const title = connection === "unconfigured" || connection === "unpaired"
      ? "PAIR"
      : connection === "incompatible"
        ? "UPDATE\nDIRECTOR"
        : "OFFLINE";
    return { title, state: 0, image: images.grey };
  }
  if (!state) return { title: "OFFLINE", state: 0, image: images.grey };

  switch (action) {
    case "run-status": {
      const title = state.run.held || state.run.allStopHold
        ? "HELD"
        : state.run.paused
          ? "PAUSED"
          : state.run.live
            ? "LIVE"
            : state.run.preflightCurrent && state.run.lastPreflightOk === true
              ? "PREFLT OK"
              : "IDLE";
      const image = title === "HELD" || title === "PAUSED" ? images.amber : title === "LIVE" ? images.red : images.grey;
      return { title, state: 0, image };
    }
    case "preflight":
      return { title: state.run.lastPreflightOk === true ? "PREFLT OK" : "PREFLT", state: 0, image: state.run.lastPreflightOk ? images.green : images.grey };
    case "start-run":
      return {
        title: !state.run.preflightCurrent || !state.run.admit ? "NEEDS\nPREFLT" : state.run.live ? "LIVE" : "START",
        state: 0,
        image: state.run.live ? images.red : images.grey,
      };
    case "pause-resume":
      return state.run.paused
        ? { title: "RESUME", state: 1, image: images.amber }
        : { title: state.run.live ? "PAUSE" : "IDLE", state: 0, image: state.run.live ? images.red : images.grey };
    case "stop-run":
      return { title: "STOP", state: 0, image: images.amber };
    case "all-stop":
      return state.run.held || state.run.allStopHold
        ? { title: "HELD", state: 0, image: images.amber }
        : { title: "ALL STOP", state: 0, image: images.red };
    case "obs-scene": {
      const scene = settings.scene?.trim();
      const selected = Boolean(scene && state.obs.programScene === scene);
      return { title: scene || "SELECT\nSCENE", state: 0, image: selected ? images.green : images.grey };
    }
    case "obs-stream":
      return state.obs.streaming === null
        ? { title: "OBS ?", state: 0, image: images.grey }
        : { title: state.obs.streaming ? "STREAM\nON" : "STREAM\nOFF", state: state.obs.streaming ? 1 : 0, image: state.obs.streaming ? images.green : images.grey };
    case "obs-record":
      return state.obs.recording === null
        ? { title: "OBS ?", state: 0, image: images.grey }
        : { title: state.obs.recording ? "RECORD\nON" : "RECORD\nOFF", state: state.obs.recording ? 1 : 0, image: state.obs.recording ? images.green : images.grey };
    case "service": {
      const service = state.services.find(item => item.id === settings.serviceId);
      if (!service) return { title: "SELECT\nSERVICE", state: 0, image: images.grey };
      const title = `${service.label}\n${service.state.toUpperCase()}`;
      return { title, state: service.state === "running" ? 1 : 0, image: service.state === "running" ? images.green : images.grey };
    }
    case "connection":
      return { title: "CONNECTED", state: 0, image: images.green };
  }
}
