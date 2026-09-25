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
  createdAt: number;
  updatedAt: number;
  /** Soft delete timestamp. Deleting a parent stamps its whole subtree. */
  deletedAt: number | null;
}

/** Key used in `childrenByParent` for top-level nodes. */
export const ROOT = '__root__' as const;

export function parentKey(parentId: string | null): string {
  return parentId ?? ROOT;
}

export function isLive(node: Node | undefined): node is Node {
  return node !== undefined && node.deletedAt === null;
}
