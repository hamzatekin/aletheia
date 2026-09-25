import { v7 } from 'uuid';

/** Time-ordered UUIDv7. Used for node and operation IDs. */
export function newId(): string {
  return v7();
}
