import type { LocalizedText } from '@portfolio/luna-shopper/contracts';

/** A leaf of the taxonomy: a row with a parent, where products go (plan 0166). */
export interface ReferenceCategoryLeaf {
  /** Ascii kebab case, unique across the whole tree, and never renamed. */
  slug: string;
  name: LocalizedText;
}

/** A root of the taxonomy and its children, in the order they are shown. */
export interface ReferenceCategoryRoot {
  slug: string;
  name: LocalizedText;
  children: ReferenceCategoryLeaf[];
}
