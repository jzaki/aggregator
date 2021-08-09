import { IClock } from "../../src/helpers/Clock.ts";

type WaitEntry = {
  resolve: () => void;
  triggerTime: number;
};

export default class TestClock implements IClock {
  // A trillion milliseconds after the unix epoch, which is mid-2001
  static startTime = 1e12;

  #time = TestClock.startTime;

  waitQueue: WaitEntry[] = [];
  autoAdvance = false;

  now() {
    return this.#time;
  }

  async wait(millis: number) {
    if (millis > 0) {
      const triggerTime = this.now() + millis;

      if (this.autoAdvance) {
        setTimeout(() => {
          this.advance(triggerTime - this.now());
        });
      }

      await new Promise<void>((resolve) => {
        this.waitQueue.push({ resolve, triggerTime });
      });
    }
  }

  async advance(millis: number) {
    const targetTime = this.now() + millis;

    while (true) {
      this.waitQueue.sort((a, b) => a.triggerTime - b.triggerTime);
      const firstEntry = this.waitQueue[0];

      if (firstEntry === undefined || firstEntry?.triggerTime > targetTime) {
        break;
      }

      const concurrentEntries = [];

      while (this.waitQueue[0]?.triggerTime === firstEntry.triggerTime) {
        concurrentEntries.push(this.waitQueue.shift()!);
      }

      this.#time = firstEntry.triggerTime;

      for (const entry of concurrentEntries) {
        entry.resolve();
      }

      // Wait for a macrotask to allow all microtasks to run
      await new Promise((resolve) => setTimeout(resolve));
    }

    this.#time = targetTime;
  }
}
