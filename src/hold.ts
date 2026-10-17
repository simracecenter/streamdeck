// SPDX-License-Identifier: GPL-3.0-or-later
export interface HoldClock {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const systemClock: HoldClock = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: timer => clearTimeout(timer),
};

export class HoldToFire {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pressed = false;
  private armed = false;

  constructor(
    private readonly fire: () => void,
    private readonly cancelled: () => void,
    private readonly duration = 1_000,
    private readonly clock: HoldClock = systemClock,
  ) {}

  keyDown(): boolean {
    if (this.pressed) return false;
    this.pressed = true;
    this.armed = true;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.armed = false;
      this.fire();
    }, this.duration);
    return true;
  }

  keyUp(): boolean {
    if (!this.pressed) return false;
    this.pressed = false;
    if (!this.armed || !this.timer) return false;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.armed = false;
    this.cancelled();
    return true;
  }
}
