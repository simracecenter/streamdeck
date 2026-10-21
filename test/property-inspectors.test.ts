// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

type PluginMessage = Record<string, unknown>;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly sent: PluginMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(message: string): void {
    this.sent.push(JSON.parse(message) as PluginMessage);
  }

  open(): void {
    this.onopen?.();
  }

  message(message: PluginMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

type InspectorWindow = {
  connectElgatoStreamDeckSocket(
    port: number,
    pluginUUID: string,
    registerEvent: string,
    info: string,
    actionInfo: string,
  ): void;
  document: Document;
  Event: typeof Event;
};

const inspectors = [
  {
    file: "connection.html",
    action: "com.simracecenter.director.connection",
    kind: "connection",
  },
  {
    file: "scene.html",
    action: "com.simracecenter.director.obs-scene",
    kind: "scene",
  },
  {
    file: "service.html",
    action: "com.simracecenter.director.service",
    kind: "service",
  },
  {
    file: "focus-weight.html",
    action: "com.simracecenter.director.focus-weight",
    kind: "focus",
  },
] as const;

describe.each(inspectors)("$file", ({ file, action, kind }) => {
  it("registers and sends plugin messages with the property inspector UUID", async () => {
    const uiDirectory = process.env.PI_HTML_ROOT ?? resolve("com.simracecenter.director.sdPlugin/ui");
    const html = await readFile(resolve(uiDirectory, file), "utf8");
    FakeWebSocket.instances = [];
    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.defineProperty(window, "WebSocket", { value: FakeWebSocket });
      },
    });

    try {
      const window = dom.window as unknown as InspectorWindow;
      window.connectElgatoStreamDeckSocket(
        28196,
        "PI-UUID",
        "registerPropertyInspector",
        "{}",
        JSON.stringify({
          action,
          context: "ACTION-CONTEXT",
          device: "DEV1",
          payload: { settings: {} },
        }),
      );

      const socket = FakeWebSocket.instances[0];
      expect(socket).toBeDefined();
      socket!.open();
      expect(socket!.url).toBe("ws://127.0.0.1:28196");
      expect(socket!.sent).toContainEqual({
        event: "registerPropertyInspector",
        uuid: "PI-UUID",
      });

      if (kind === "connection") {
        window.document.querySelector<HTMLInputElement>("#code")!.value = "123456";
        window.document.querySelector<HTMLInputElement>("#name")!.value = "Test Deck";
        window.document.querySelector<HTMLButtonElement>("#pair")!.click();
      } else if (kind === "scene") {
        socket!.message({
          event: "sendToPropertyInspector",
          payload: { type: "scene-options", scenes: ["Race", "Pits"], liveScenes: ["Race"] },
        });
        const select = window.document.querySelector<HTMLSelectElement>("#scene")!;
        select.value = "scene:Race";
        select.dispatchEvent(new window.Event("change", { bubbles: true }));
      } else if (kind === "focus") {
        socket!.message({
          event: "sendToPropertyInspector",
          payload: { type: "focus-options", coverage: { focusWeight: 0.75, profile: "balanced" } },
        });
        expect(window.document.querySelector("#current")!.textContent).toContain("75%");
        const value = window.document.querySelector<HTMLInputElement>("#value")!;
        value.value = "100";
        value.dispatchEvent(new window.Event("change", { bubbles: true }));
      } else {
        socket!.message({
          event: "sendToPropertyInspector",
          payload: { type: "service-options", services: [{ id: "chatAgent", label: "Chat Agent" }] },
        });
        const select = window.document.querySelector<HTMLSelectElement>("#service")!;
        select.value = "chatAgent";
        select.dispatchEvent(new window.Event("change", { bubbles: true }));
      }

      const pluginMessages = socket!.sent.filter(message => message.event === "sendToPlugin");
      if (kind === "focus") {
        // Empty settings are committed as the BALANCED preset on connect so a freshly dropped key works untouched.
        expect(pluginMessages.map(message => message.payload)).toEqual([
          { type: "set-focus", focusMode: "preset", focusValue: 0.5 },
          { type: "set-focus", focusMode: "preset", focusValue: 1 },
        ]);
      } else {
        expect(pluginMessages).toHaveLength(1);
      }
      for (const message of pluginMessages) {
        expect(message.context).toBe("PI-UUID");
        expect(message.action).toBe(action);
      }
    } finally {
      dom.window.close();
    }
  });
});
