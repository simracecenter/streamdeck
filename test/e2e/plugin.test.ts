// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it } from "vitest";
import { FakeDirector, FAKE_TOKEN } from "../fake-director";
import { FakeStreamDeckHost, pluginUuid } from "./fake-host";

const runStatus = `${pluginUuid}.run-status`;
const preflight = `${pluginUuid}.preflight`;
const startRun = `${pluginUuid}.start-run`;
const pauseResume = `${pluginUuid}.pause-resume`;
const stopRun = `${pluginUuid}.stop-run`;
const allStop = `${pluginUuid}.all-stop`;
const obsScene = `${pluginUuid}.obs-scene`;
const obsStream = `${pluginUuid}.obs-stream`;
const obsRecord = `${pluginUuid}.obs-record`;
const service = `${pluginUuid}.service`;
const connection = `${pluginUuid}.connection`;

describe("built plugin with fake Stream Deck host", () => {
  let director: FakeDirector;
  let host: FakeStreamDeckHost;
  afterEach(async () => {
    await host?.close();
    await director?.close();
  });

  it("pairs from the PI, receives SSE updates, and exercises run, scene, and stream controls", async () => {
    director = new FakeDirector();
    await director.start();
    host = new FakeStreamDeckHost();
    await host.start();
    host.send(connection, "willAppear", {}, "connection-context");
    host.send(connection, "propertyInspectorDidAppear", {}, "connection-context");
    host.send(connection, "sendToPlugin", {
      type: "pair",
      directorUrl: director.url,
      code: "123456",
      name: "E2E Deck",
    }, "connection-context");
    await host.waitFor(message => message.event === "setGlobalSettings");
    await host.waitFor(message => message.event === "sendToPropertyInspector");
    host.send(runStatus, "willAppear");
    await host.waitFor(message => message.event === "setTitle" && Boolean(message.payload) && (message.payload as any).title === "IDLE");
    director.setState(state => { state.run.live = true; });
    await host.waitFor(message => message.event === "setTitle" && (message.payload as any)?.title === "LIVE");

    host.send(preflight, "willAppear");
    host.send(preflight, "keyDown");
    await host.waitFor(message => message.event === "showOk");
    host.send(startRun, "willAppear");
    host.send(startRun, "keyDown");
    await host.waitFor(message => message.event === "showOk" && message.context === `${startRun}-context`);
    host.send(pauseResume, "willAppear");
    host.send(pauseResume, "keyDown");
    await host.waitFor(message => message.event === "showOk" && message.context === `${pauseResume}-context`);
    host.send(pauseResume, "keyDown");
    await host.waitFor(message =>
      message.event === "showOk" &&
      message.context === `${pauseResume}-context` &&
      host.messages.filter(item => item.event === "showOk" && item.context === `${pauseResume}-context`).length >= 2);
    expect(director.commands.map(item => item.command)).toContain("run.preflight");
    expect(director.commands.map(item => item.command)).toContain("run.start");
    expect(director.commands.map(item => item.command)).toContain("run.pause");
    expect(director.commands.map(item => item.command)).toContain("run.resume");

    host.send(obsScene, "willAppear", { settings: { scene: "Replay" } }, "scene-context");
    host.send(obsScene, "sendToPlugin", { type: "set-scene", scene: "Replay" }, "scene-context");
    host.send(obsScene, "keyDown", { settings: { scene: "Replay" } }, "scene-context");
    await host.waitFor(message => message.event === "showOk" && message.context === "scene-context");
    expect(director.commands.some(item => item.command === "obs.setScene" && item.args.scene === "Replay")).toBe(true);
    await host.waitFor(message => message.event === "setImage" && message.context === "scene-context" &&
      String((message.payload as any)?.image).includes("green"));

    host.send(obsScene, "willAppear", { settings: { slot: 2 } }, "scene-slot-context");
    await host.waitFor(message => message.event === "setTitle" &&
      message.context === "scene-slot-context" &&
      (message.payload as any)?.title === "Replay");
    host.send(obsScene, "keyDown", { settings: { slot: 2 } }, "scene-slot-context");
    await host.waitFor(message => message.event === "showOk" && message.context === "scene-slot-context");
    expect(director.commands.some(item => item.command === "obs.setScene" && item.args.scene === "Replay")).toBe(true);
    const sceneCommandCount = director.commands.filter(item => item.command === "obs.setScene").length;
    host.send(obsScene, "willAppear", { settings: { slot: 8 } }, "missing-scene-slot");
    await host.waitFor(message => message.event === "setTitle" &&
      message.context === "missing-scene-slot" &&
      (message.payload as any)?.title === "SCENE 8\n—");
    host.send(obsScene, "keyDown", { settings: { slot: 8 } }, "missing-scene-slot");
    await host.waitFor(message => message.event === "showAlert" && message.context === "missing-scene-slot");
    expect(director.commands.filter(item => item.command === "obs.setScene")).toHaveLength(sceneCommandCount);

    host.send(obsStream, "willAppear");
    host.send(obsStream, "keyDown");
    await host.waitFor(message => message.event === "showOk" && message.context === `${obsStream}-context`);
    await host.waitFor(message => message.event === "setTitle" &&
      message.context === `${obsStream}-context` &&
      (message.payload as any)?.title === "STREAM\nON");
    host.send(obsStream, "keyDown");
    await new Promise(resolve => setTimeout(resolve, 1_050));
    host.send(obsStream, "keyUp");
    await host.waitFor(message =>
      message.event === "showOk" &&
      message.context === `${obsStream}-context` &&
      host.messages.filter(item => item.event === "showOk" && item.context === `${obsStream}-context`).length >= 2);
    const streamCommands = director.commands.filter(item => item.command === "obs.setStream");
    expect(streamCommands.map(item => item.args.enabled)).toEqual([true, false]);
    expect(FAKE_TOKEN).toBeTruthy();
  });

  it("cancels short stops, fires held stops and ALL STOP once, and toggles services", async () => {
    director = new FakeDirector();
    await director.start();
    host = new FakeStreamDeckHost();
    await host.start({ directorUrl: director.url, token: FAKE_TOKEN });
    host.send(stopRun, "willAppear", {}, "stop-short");
    host.send(stopRun, "keyDown", {}, "stop-short");
    host.send(stopRun, "keyUp", {}, "stop-short");
    await new Promise(resolve => setTimeout(resolve, 1_050));
    expect(director.commands.some(item => item.command === "run.stop")).toBe(false);

    host.send(stopRun, "willAppear", {}, "stop-hold");
    host.send(stopRun, "keyDown", {}, "stop-hold");
    host.send(stopRun, "keyDown", {}, "stop-hold");
    await new Promise(resolve => setTimeout(resolve, 1_050));
    host.send(stopRun, "keyUp", {}, "stop-hold");
    await host.waitFor(message => message.event === "showOk" && message.context === "stop-hold");
    expect(director.commands.filter(item => item.command === "run.stop")).toHaveLength(1);

    host.send(allStop, "willAppear", {}, "all-stop");
    host.send(allStop, "keyDown", {}, "all-stop");
    await new Promise(resolve => setTimeout(resolve, 1_050));
    host.send(allStop, "keyUp", {}, "all-stop");
    await host.waitFor(message => message.event === "showOk" && message.context === "all-stop");
    expect(director.commands.filter(item => item.command === "run.allStop")).toHaveLength(1);

    host.send(service, "willAppear", { settings: { serviceId: "spectator" } }, "service");
    host.send(service, "keyDown", { settings: { serviceId: "spectator" } }, "service");
    await host.waitFor(message => message.event === "showOk" && message.context === "service");
    host.send(service, "keyDown", { settings: { serviceId: "spectator" } }, "service");
    await host.waitFor(message =>
      message.event === "showOk" &&
      message.context === "service" &&
      host.messages.filter(item => item.event === "showOk" && item.context === "service").length >= 2);
    expect(director.commands.map(item => item.command)).toContain("service.start");
    expect(director.commands.map(item => item.command)).toContain("service.stop");
  });

  it("ignores duplicate keyDown events while a command is in flight", async () => {
    director = new FakeDirector();
    await director.start();
    host = new FakeStreamDeckHost();
    await host.start({ directorUrl: director.url, token: FAKE_TOKEN });
    host.send(preflight, "willAppear", {}, "preflight-duplicate");
    await host.waitFor(message => message.event === "setTitle" && message.context === "preflight-duplicate" &&
      (message.payload as any)?.title === "PREFLT");
    host.send(preflight, "keyDown", {}, "preflight-duplicate");
    host.send(preflight, "keyDown", {}, "preflight-duplicate");
    await host.waitFor(message => message.event === "showOk" && message.context === "preflight-duplicate");
    expect(director.commands.filter(item => item.command === "run.preflight")).toHaveLength(1);
  });

  it("shows every visible key offline, recovers, and shows PAIR for a revoked token", async () => {
    director = new FakeDirector();
    await director.start();
    const stablePort = Number(new URL(director.url).port);
    host = new FakeStreamDeckHost();
    await host.start({ directorUrl: director.url, token: FAKE_TOKEN });

    const visibleActions = [
      { action: runStatus, context: "offline-status" },
      { action: preflight, context: "offline-preflight" },
      { action: startRun, context: "offline-start" },
      { action: pauseResume, context: "offline-pause" },
      { action: stopRun, context: "offline-stop" },
      { action: allStop, context: "offline-all-stop" },
      { action: obsScene, context: "offline-scene", settings: { scene: "Replay" } },
      { action: obsStream, context: "offline-stream" },
      { action: obsRecord, context: "offline-record" },
      { action: service, context: "offline-service", settings: { serviceId: "spectator" } },
      { action: connection, context: "offline-connection" },
    ];
    for (const visible of visibleActions) {
      host.send(visible.action, "willAppear", { settings: visible.settings ?? {} }, visible.context);
    }
    await host.waitFor(message => message.event === "setTitle" && message.context === "offline-status" &&
      (message.payload as any)?.title === "IDLE");
    await host.waitFor(message => message.event === "setTitle" && message.context === "offline-connection" &&
      (message.payload as any)?.title === "CONNECTED");

    const offlineAfter = host.messages.length;
    await director.close();
    await Promise.all(visibleActions.map(visible => host.waitFor(
      message => message.event === "setTitle" && message.context === visible.context &&
        (message.payload as any)?.title === "OFFLINE",
      3_000,
      offlineAfter,
    )));

    const recoveryAfter = host.messages.length;
    await director.start(stablePort);
    await Promise.all(visibleActions.map(visible => host.waitFor(
      message => message.event === "setTitle" && message.context === visible.context &&
        !["OFFLINE", "PAIR"].includes(String((message.payload as any)?.title)),
      5_000,
      recoveryAfter,
    )));

    const revokedAfter = host.messages.length;
    director.revoke();
    await Promise.all(visibleActions.map(visible => host.waitFor(
      message => message.event === "setTitle" && message.context === visible.context &&
        (message.payload as any)?.title === "PAIR",
      5_000,
      revokedAfter,
    )));
  });
});
