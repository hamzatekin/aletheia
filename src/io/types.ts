/** A node-to-be, as produced by importers and consumed by `importItems`. */
export interface OutlineItem {
  content: string;
  note: string;
  children: OutlineItem[];
}
