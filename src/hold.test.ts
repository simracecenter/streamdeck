// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HoldToFire } from "./hold";

describe("HoldToFire", () => {
  beforeEach(() => vi.useFakeTimers());

  it("cancels a short press and reports HOLD", () => {
    const fire = vi.fn();
    const cancel = vi.fn();
    const hold = new HoldToFire(fire, cancel);
    hold.keyDown();
    expect(hold.keyUp()).toBe(true);
    expect(fire).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("fires once after one second and ignores repeated keyDown", () => {
    const fire = vi.fn();
    const hold = new HoldToFire(fire, vi.fn());
    expect(hold.keyDown()).toBe(true);
    expect(hold.keyDown()).toBe(false);
    vi.advanceTimersByTime(999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledOnce();
    expect(hold.keyUp()).toBe(false);
  });
});
