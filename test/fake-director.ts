// SPDX-License-Identifier: GPL-3.0-or-later
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { controlCommandSchema, type ControlCommand, type ControlState } from "../src/contract";

export const FAKE_TOKEN = "fake-director-token";

export function initialState(): ControlState {
  return {
    api: 1,
    run: {
      available: true,
      live: false,
      paused: false,
      held: false,
      allStopHold: false,
      holdReason: null,
      preflightCurrent: false,
      admit: false,
      admitReason: null,
      lastPreflightOk: null,
      runId: null,
    },
    obs: {
      connected: true,
      programScene: "Grid",
      scenes: ["Grid", "Replay", "Podium"],
      liveScenes: ["Grid", "Replay", "Podium"],
      streaming: false,
      recording: false,
    },
    coverage: { focusWeight: 0.5, profile: "balanced" },
    services: [
      { id: "youtubeChat", label: "YT CHAT", state: "stopped", detail: null, canStart: true, canStop: false },
      { id: "chatAgent", label: "CHAT AGENT", state: "stopped", detail: null, canStart: true, canStop: false },
      { id: "spectator", label: "SPECTATOR", state: "stopped", detail: null, canStart: true, canStop: false },
    ],
  };
}

export class FakeDirector {
  private server: Server;
  private portValue: number | null = null;
  private clients = new Set<ServerResponse>();
  private currentState = initialState();
  private revoked = false;
  readonly commands: ControlCommand[] = [];

  constructor() {
    this.server = createServer((request, response) => void this.handle(request, response));
  }

  get url(): string {
    if (this.portValue === null) throw new Error("Fake Director is not listening");
    return `http://127.0.0.1:${this.portValue}`;
  }

  state(): ControlState {
    return structuredClone(this.currentState);
  }

  async start(port = 0): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        this.server.off("error", reject);
        this.portValue = (this.server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.end();
    this.clients.clear();
    if (!this.server.listening) return;
    await new Promise<void>(resolve => this.server.close(() => resolve()));
    this.server.closeAllConnections();
    this.portValue = null;
  }

  revoke(): void {
    this.revoked = true;
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  setState(update: (state: ControlState) => void): void {
    update(this.currentState);
    const data = JSON.stringify(this.currentState);
    for (const client of this.clients) client.write(`event: state\ndata: ${data}\n\n`);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.headers.origin !== undefined) {
      this.json(response, 403, { error: "origin not allowed" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/pair") {
      const body = await this.readBody(request);
      if (body?.code === "123456" && typeof body.name === "string") {
        this.revoked = false;
        this.json(response, 200, { surfaceId: "surface-1", token: FAKE_TOKEN });
      } else this.json(response, 401, { error: "invalid or expired pairing code" });
      return;
    }
    if (!this.authorized(request)) {
      this.json(response, 401, { error: "invalid token" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/capabilities") {
      this.json(response, 200, {
        api: 1,
        directorVersion: "test",
        commands: [
          "run.preflight", "run.start", "run.pause", "run.resume", "run.stop", "run.allStop",
          "obs.setScene", "obs.setStream", "obs.setRecord", "service.start", "service.stop", "service.restart",
          "coverage.setFocusWeight", "coverage.adjustFocusWeight",
        ],
        services: ["youtubeChat", "chatAgent", "spectator"],
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/state") {
      this.json(response, 200, this.currentState);
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      response.write(`event: state\ndata: ${JSON.stringify(this.currentState)}\n\n`);
      this.clients.add(response);
      response.on("close", () => this.clients.delete(response));
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/commands") {
      const body = await this.readBody(request);
      const parsed = body && controlCommandSchema.safeParse({
        command: body.command,
        ...(body.args === undefined ? {} : { args: body.args }),
      });
      if (!parsed || !parsed.success) {
        this.json(response, 400, { error: "invalid command" });
        return;
      }
      const command = parsed.data as ControlCommand;
      this.commands.push(command);
      this.apply(command);
      this.json(response, 200, { ok: true, detail: "accepted", state: this.currentState });
      return;
    }
    this.json(response, 404, { error: "not found" });
  }

  private apply(command: ControlCommand): void {
    this.setState(state => {
      switch (command.command) {
        case "run.preflight":
          state.run.preflightCurrent = true;
          state.run.lastPreflightOk = true;
          state.run.admit = true;
          break;
        case "run.start":
          state.run.live = true;
          state.run.paused = false;
          break;
        case "run.pause":
          state.run.paused = true;
          break;
        case "run.resume":
          state.run.paused = false;
          break;
        case "run.stop":
          state.run.live = false;
          state.run.paused = false;
          break;
        case "run.allStop":
          state.run.held = true;
          state.run.allStopHold = true;
          break;
        case "obs.setScene":
          state.obs.programScene = command.args.scene;
          break;
        case "obs.setStream":
          state.obs.streaming = command.args.enabled;
          break;
        case "obs.setRecord":
          state.obs.recording = command.args.enabled;
          break;
        case "service.start":
        case "service.stop": {
          const service = state.services.find(item => item.id === command.args.id);
          if (!service) return;
          const starting = command.command === "service.start";
          service.state = starting ? "running" : "stopped";
          service.canStart = !starting;
          service.canStop = starting;
          break;
        }
        case "service.restart":
          break;
        case "coverage.setFocusWeight":
          state.coverage.focusWeight = command.args.weight;
          break;
        case "coverage.adjustFocusWeight":
          state.coverage.focusWeight = Math.max(0, Math.min(1, Math.round((state.coverage.focusWeight + command.args.delta) * 1000) / 1000));
          break;
      }
    });
  }

  private authorized(request: IncomingMessage): boolean {
    return !this.revoked && request.headers.authorization === `Bearer ${FAKE_TOKEN}`;
  }

  private async readBody(request: IncomingMessage): Promise<Record<string, any> | null> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, any>;
    } catch {
      return null;
    }
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }
}
