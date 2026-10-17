// SPDX-License-Identifier: GPL-3.0-or-later
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

export const pluginUuid = "com.simracecenter.director";
export const pluginPath = resolve("com.simracecenter.director.sdPlugin/bin/plugin.js");

export class FakeStreamDeckHost {
  readonly messages: Record<string, unknown>[] = [];
  private readonly actionSettings = new Map<string, Record<string, unknown>>();
  private server!: WebSocketServer;
  private socket!: WebSocket;
  private child!: ChildProcess;
  private childOutput = "";
  private waiters: Array<() => void> = [];

  async start(settings: Record<string, unknown> = {}): Promise<void> {
    this.server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>(resolve => this.server.once("listening", resolve));
    const port = this.server.address();
    if (!port || typeof port === "string") throw new Error("Fake host did not bind");
    this.server.on("connection", socket => {
      this.socket = socket;
      socket.on("message", data => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        this.messages.push(message);
        if (message.event === "getGlobalSettings") {
          socket.send(JSON.stringify({
            event: "didReceiveGlobalSettings",
            id: message.id,
            payload: { settings },
          }));
        } else if (message.event === "getSettings") {
          socket.send(JSON.stringify({
            event: "didReceiveSettings",
            context: message.context,
            id: message.id,
            payload: { settings: this.actionSettings.get(String(message.context)) ?? {} },
          }));
        } else if (message.event === "setSettings") {
          const actionSettings = message.payload as Record<string, unknown>;
          this.actionSettings.set(String(message.context), actionSettings);
          socket.send(JSON.stringify({
            event: "didReceiveSettings",
            context: message.context,
            payload: { settings: actionSettings },
          }));
        }
        this.wake();
      });
    });
    const info = {
      application: { font: "", language: "en", platform: "windows", platformVersion: "10", version: "7.6.0.23012" },
      plugin: { uuid: pluginUuid, version: "0.1.0.0" },
      devicePixelRatio: 1,
      colors: {},
      devices: [{ id: "DEV1", name: "Fake Deck", size: { columns: 5, rows: 3 }, type: 0 }],
    };
    this.child = spawn(process.execPath, [
      pluginPath,
      "-port", String(port.port),
      "-pluginUUID", pluginUuid,
      "-registerEvent", "registerPlugin",
      "-info", JSON.stringify(info),
    ], {
      cwd: resolve("com.simracecenter.director.sdPlugin"),
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout?.on("data", data => { this.childOutput += data.toString(); });
    this.child.stderr?.on("data", data => { this.childOutput += data.toString(); });
    this.child.on("error", error => { this.childOutput += String(error); });
    this.child.on("exit", (code, signal) => { this.childOutput += `\nexit=${code} signal=${signal}`; });
    await this.waitFor(message => message.event === "registerPlugin");
  }

  send(action: string, event: string, payload: Record<string, unknown> = {}, context = `${action}-context`): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Plugin WebSocket is not open");
    const settings = payload.settings;
    if (settings && typeof settings === "object") {
      this.actionSettings.set(context, settings as Record<string, unknown>);
    }
    socket.send(JSON.stringify({
      event,
      action,
      context,
      device: "DEV1",
      payload: {
        controller: "Keypad",
        coordinates: { column: 0, row: 0 },
        isInMultiAction: false,
        settings: {},
        state: 0,
        ...payload,
      },
    }));
  }

  async waitFor(
    predicate: (message: Record<string, unknown>) => boolean,
    timeout = 5_000,
    afterIndex = 0,
  ): Promise<Record<string, unknown>> {
    const findMatch = () => this.messages.findIndex((message, index) => index >= afterIndex && predicate(message));
    const existingIndex = findMatch();
    if (existingIndex >= 0) return this.messages[existingIndex];
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 25);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
      const messageIndex = findMatch();
      if (messageIndex >= 0) return this.messages[messageIndex];
    }
    throw new Error(`Timed out waiting for Stream Deck message; child output: ${this.childOutput}; messages: ${JSON.stringify(this.messages)}`);
  }

  async close(): Promise<void> {
    this.child?.kill();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
    await new Promise<void>(resolve => this.server?.close(() => resolve()));
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}
