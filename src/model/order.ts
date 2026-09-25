import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/** A sibling order key strictly between `a` and `b` (either may be null for open ends). */
export function orderBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b);
}

export function ordersBetween(a: string | null, b: string | null, n: number): string[] {
  return generateNKeysBetween(a, b, n);
}
