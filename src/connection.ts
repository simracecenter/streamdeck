// SPDX-License-Identifier: GPL-3.0-or-later
import { ZodError } from "zod";
import {
  controlCommandIds,
  controlStateSchema,
  type ControlCommand,
  type ControlState,
} from "./contract";
import { DirectorClient, DirectorCommandError, type ControlCapabilities } from "./director-client";

export const DEFAULT_DIRECTOR_URL = "http://127.0.0.1:8782";
export type ConnectionStatus = "unconfigured" | "unpaired" | "connecting" | "connected" | "offline" | "incompatible";
export type GlobalSettings = { directorUrl?: string; token?: string };
export interface ConnectionSnapshot {
  connection: ConnectionStatus;
  state: ControlState | null;
}

type Client = Pick<DirectorClient, "capabilities" | "subscribe" | "command" | "pair">;
type Timer = ReturnType<typeof setTimeout>;

export interface DirectorConnectionOptions {
  makeClient?: (url: string, token: string) => Client;
  saveSettings?: (settings: GlobalSettings) => Promise<void>;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
}

const reconnectDelays = [1_000, 2_000, 5_000, 10_000] as const;

export class DirectorConnection {
  private settings: GlobalSettings = { directorUrl: DEFAULT_DIRECTOR_URL };
  private current: ConnectionSnapshot = { connection: "unconfigured", state: null };
  private listeners = new Set<(snapshot: ConnectionSnapshot) => void>();
  private abort: AbortController | null = null;
  private timer: Timer | null = null;
  private generation = 0;
  private retryIndex = 0;
  private readonly makeClient: (url: string, token: string) => Client;
  private readonly schedule: (callback: () => void, delay: number) => Timer;
  private readonly cancel: (timer: Timer) => void;

  constructor(private readonly options: DirectorConnectionOptions = {}) {
    this.makeClient = options.makeClient ?? ((url, token) => new DirectorClient(url, token));
    this.schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancel = options.cancel ?? (timer => clearTimeout(timer));
  }

  snapshot(): ConnectionSnapshot {
    return this.current;
  }

  directorUrl(): string {
    return this.settings.directorUrl ?? DEFAULT_DIRECTOR_URL;
  }

  onChange(listener: (snapshot: ConnectionSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  configure(settings: GlobalSettings): void {
    this.settings = {
      directorUrl: typeof settings.directorUrl === "string" ? settings.directorUrl.trim() : DEFAULT_DIRECTOR_URL,
      ...(typeof settings.token === "string" && settings.token.length > 0 ? { token: settings.token } : {}),
    };
    this.retryIndex = 0;
    this.connectNow();
  }

  reconnect(): void {
    this.retryIndex = 0;
    this.connectNow();
  }

  async pair(code: string, name: string, directorUrl?: string): Promise<void> {
    const url = (directorUrl ?? this.settings.directorUrl ?? DEFAULT_DIRECTOR_URL).trim();
    if (!isHttpUrl(url)) throw new Error("Enter a valid Director URL");
    const result = await this.makeClient(url, "").pair(code, name);
    const settings = { directorUrl: url, token: result.token };
    await this.options.saveSettings?.(settings);
    this.configure(settings);
  }

  command<C extends ControlCommand["command"]>(
    command: C,
    args?: Extract<ControlCommand, { command: C }> extends { args: infer A } ? A : undefined,
  ): ReturnType<DirectorClient["command"]> {
    if (this.current.connection !== "connected") {
      return Promise.reject(new Error("Director is not connected"));
    }
    const url = this.settings.directorUrl ?? DEFAULT_DIRECTOR_URL;
    return this.makeClient(url, this.settings.token ?? "").command(command, args as never);
  }

  stop(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    if (this.timer) this.cancel(this.timer);
    this.timer = null;
  }

  private connectNow(): void {
    this.stop();
    const url = this.settings.directorUrl ?? "";
    if (!isHttpUrl(url)) {
      this.setSnapshot({ connection: "unconfigured", state: null });
      return;
    }
    void this.connect(++this.generation);
  }

  private async connect(generation: number): Promise<void> {
    const controller = new AbortController();
    this.abort = controller;
    this.setSnapshot({ connection: "connecting", state: null });
    const client = this.makeClient(this.settings.directorUrl ?? DEFAULT_DIRECTOR_URL, this.settings.token ?? "");
    try {
      const capabilities = await client.capabilities();
      if (generation !== this.generation) return;
      if (!isCompatible(capabilities)) {
        this.setSnapshot({ connection: "incompatible", state: null });
        return;
      }
      for await (const state of client.subscribe(controller.signal)) {
        if (generation !== this.generation) return;
        const parsed = controlStateSchema.safeParse(state);
        if (!parsed.success) {
          this.abort?.abort();
          this.setSnapshot({ connection: "incompatible", state: null });
          return;
        }
        this.retryIndex = 0;
        this.setSnapshot({ connection: "connected", state: parsed.data });
      }
      if (!controller.signal.aborted && generation === this.generation) throw new Error("Director event stream ended");
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return;
      if (error instanceof ZodError) {
        this.setSnapshot({ connection: "incompatible", state: null });
        return;
      }
      if (error instanceof DirectorCommandError && error.status === 401) {
        this.setSnapshot({ connection: "unpaired", state: null });
        return;
      }
      this.setSnapshot({ connection: "offline", state: null });
      this.scheduleReconnect(generation);
    }
  }

  private scheduleReconnect(generation: number): void {
    const delay = reconnectDelays[Math.min(this.retryIndex, reconnectDelays.length - 1)];
    this.retryIndex = Math.min(this.retryIndex + 1, reconnectDelays.length - 1);
    this.timer = this.schedule(() => {
      this.timer = null;
      if (generation === this.generation) void this.connect(++this.generation);
    }, delay);
  }

  private setSnapshot(snapshot: ConnectionSnapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function isCompatible(capabilities: ControlCapabilities): boolean {
  return capabilities.api === 1 && controlCommandIds.every(command => capabilities.commands.includes(command));
}

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
