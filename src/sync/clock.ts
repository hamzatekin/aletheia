/**
 * A hybrid logical clock folded into plain millisecond numbers: the wall
 * clock, but always later than every time this device has made or seen. An
 * edit made after seeing another device's change is therefore newer than that
 * change, even when this device's clock runs behind.
 */
export interface Clock {
  now(): number;
  /** Note a time made elsewhere (a pulled change). */
  observe(t: number): void;
}

export function createClock(wall: () => number = Date.now): Clock {
  let last = 0;
  return {
    now() {
      last = Math.max(wall(), last + 1);
      return last;
    },
    observe(t) {
      if (Number.isFinite(t) && t > last) last = t;
    },
  };
}
