/**
 * The tree is the source of truth. Nodes are stored flat; hierarchy lives in
 * `parentId` + `order`. Markdown is only the *content* format of a node.
 */
export interface Node {
  /** UUIDv7, stable forever. */
  id: string;
  /** `null` = top level. Exactly one parent per node (strict tree). */
  parentId: string | null;
  /** Fractional index among siblings; plain string comparison gives sibling order. */
  order: string;
  /** Single-line inline Markdown (bold, italic, code, links). */
  content: string;
  /** Optional multi-line block Markdown. */
  note: string;
  collapsed: boolean;
  /** When the node was starred (listed under Starred in the sidebar); absent or null = not starred. */
  starredAt?: number | null;
  /** When the node was marked done (Ctrl/⌘+Enter); absent or null = not done. */
  completedAt?: number | null;
  /** Heading size, 1 (largest) to 3; absent or null = a normal row. */
  heading?: number | null;
  /** Color label, one of `COLORS`; absent or null = none. */
  color?: string | null;
  createdAt: number;
  updatedAt: number;
  /** Soft delete timestamp. Deleting a parent stamps its whole subtree. */
  deletedAt: number | null;
}

/** Color labels a row can carry, as in Dynalist. */
export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;

/** Heading sizes a row can have, as in WorkFlowy and Dynalist. */
export const HEADINGS = [1, 2, 3] as const;

/** Key used in `childrenByParent` for top-level nodes. */
export const ROOT = '__root__' as const;

export function parentKey(parentId: string | null): string {
  return parentId ?? ROOT;
}

export function isLive(node: Node | undefined): node is Node {
  return node !== undefined && node.deletedAt === null;
}
