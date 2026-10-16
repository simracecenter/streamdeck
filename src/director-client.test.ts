// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from "vitest";
import { DirectorClient, DirectorCommandError } from "./director-client";
import { FakeDirector, FAKE_TOKEN } from "../test/fake-director";

describe("DirectorClient", () => {
  it("pairs and submits a command with a unique request id", async () => {
    const director = new FakeDirector();
    await director.start();
    try {
      const unpaired = new DirectorClient(director.url, "");
      const pair = await unpaired.pair("123456", "Deck");
      expect(pair.token).toBe(FAKE_TOKEN);
      const client = new DirectorClient(director.url, pair.token);
      await expect(client.command("run.preflight")).resolves.toMatchObject({ ok: true });
      expect(director.commands).toEqual([{ command: "run.preflight" }]);
    } finally {
      await director.close();
    }
  });

  it.each([
    [401, "invalid token"],
    [409, "rejected"],
    [400, "invalid command"],
  ])("surfaces HTTP %i command errors", async (status, message) => {
    const client = new DirectorClient("http://director.test", "token", vi.fn(async () =>
      Response.json({ error: message }, { status }),
    ));
    await expect(client.command("run.preflight")).rejects.toMatchObject({
      name: "DirectorCommandError",
      status,
      message,
    });
  });

  it("normalizes network errors to status zero without logging request secrets", async () => {
    const client = new DirectorClient("http://director.test", "never-log-me", vi.fn(async () => {
      throw new Error("connect failed");
    }));
    await expect(client.capabilities()).rejects.toMatchObject({
      name: "DirectorCommandError",
      status: 0,
      message: "connect failed",
    });
  });
});
