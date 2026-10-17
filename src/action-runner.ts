// SPDX-License-Identifier: GPL-3.0-or-later
export class InFlightLock {
  private locked = false;

  get isLocked(): boolean {
    return this.locked;
  }

  async run(operation: () => Promise<void>): Promise<boolean> {
    if (this.locked) return false;
    this.locked = true;
    try {
      await operation();
      return true;
    } finally {
      this.locked = false;
    }
  }
}
