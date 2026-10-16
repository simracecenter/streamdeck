// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { InFlightLock } from "./action-runner";

describe("InFlightLock", () => {
  it("ignores duplicate presses until the running command finishes", async () => {
    const lock = new InFlightLock();
    let resolve!: () => void;
    const command = new Promise<void>(done => { resolve = done; });
    const first = lock.run(() => command);
    await expect(lock.run(async () => undefined)).resolves.toBe(false);
    expect(lock.isLocked).toBe(true);
    resolve();
    await expect(first).resolves.toBe(true);
    expect(lock.isLocked).toBe(false);
  });
});
