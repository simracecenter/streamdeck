// SPDX-License-Identifier: GPL-3.0-or-later
import { z } from "zod";
import {
  controlCommandSchema,
  controlServiceIdSchema,
  controlStateSchema,
  controlSurfacePairRequestSchema,
  type ControlCommand,
  type ControlState,
} from "./contract";
import { parseSse } from "./sse";

const controlCapabilitiesSchema = z.object({
  api: z.number().int(),
  directorVersion: z.string(),
  commands: z.array(z.string()),
  services: z.array(controlServiceIdSchema),
}).strict();

const controlPairResponseSchema = z.object({
  surfaceId: z.string(),
  token: z.string(),
}).strict();

export type ControlCapabilities = z.infer<typeof controlCapabilitiesSchema>;

export class DirectorCommandError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "DirectorCommandError";
  }
}

type CommandId = ControlCommand["command"];
type CommandArguments<C extends CommandId> =
  Extract<ControlCommand, { command: C }> extends { args: infer A } ? A : undefined;

export class DirectorClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async pair(code: string, name: string): Promise<{ surfaceId: string; token: string }> {
    const request = controlSurfacePairRequestSchema.parse({ code, name });
    const response = await this.request("/v1/pair", {
      method: "POST",
      body: JSON.stringify(request),
    }, false);
    const parsed = controlPairResponseSchema.safeParse(response);
    if (!parsed.success) throw new DirectorCommandError(200, "Invalid pairing response");
    return parsed.data;
  }

  async capabilities(): Promise<ControlCapabilities> {
    const value = await this.request("/v1/capabilities", { method: "GET" });
    return controlCapabilitiesSchema.parse(value);
  }

  async state(): Promise<ControlState> {
    const value = await this.request("/v1/state", { method: "GET" });
    return controlStateSchema.parse(value);
  }

  async command<C extends CommandId>(
    command: C,
    args?: CommandArguments<C>,
  ): Promise<{ ok: true; detail: string; state: ControlState }> {
    const parsed = controlCommandSchema.parse({ command, ...(args === undefined ? {} : { args }) });
    const response = await this.request("/v1/commands", {
      method: "POST",
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...parsed }),
    });
    const result = response as { ok?: unknown; detail?: unknown; state?: unknown };
    if (result.ok !== true || typeof result.detail !== "string") {
      throw new DirectorCommandError(200, "Invalid command response");
    }
    return { ok: true, detail: result.detail, state: controlStateSchema.parse(result.state) };
  }

  async *subscribe(signal?: AbortSignal): AsyncGenerator<ControlState> {
    const response = await this.fetchRequest("/v1/events", { method: "GET", signal });
    if (!response.ok) throw await this.errorFromResponse(response);
    if (!response.body) throw new DirectorCommandError(response.status, "Director event stream is unavailable");
    for await (const message of parseSse(response.body, signal)) {
      if (message.event !== "state") continue;
      let raw: unknown;
      try {
        raw = JSON.parse(message.data);
      } catch {
        throw new Error("Director sent invalid state JSON");
      }
      yield controlStateSchema.parse(raw);
    }
  }

  private async request(path: string, init: RequestInit, authenticated = true): Promise<unknown> {
    const response = await this.fetchRequest(path, init, authenticated);
    if (!response.ok) throw await this.errorFromResponse(response);
    try {
      return await response.json();
    } catch {
      throw new DirectorCommandError(response.status, "Director returned invalid JSON");
    }
  }

  private async fetchRequest(path: string, init: RequestInit, authenticated = true): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (authenticated && this.token) headers.set("authorization", `Bearer ${this.token}`);
    try {
      return await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new DirectorCommandError(0, error instanceof Error ? error.message : "Network error");
    }
  }

  private async errorFromResponse(response: Response): Promise<DirectorCommandError> {
    let message = response.statusText || "Director request failed";
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Use the HTTP status text when the response is not JSON.
    }
    return new DirectorCommandError(response.status, message);
  }
}
