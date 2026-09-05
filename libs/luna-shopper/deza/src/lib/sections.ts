import { decodeText, sliceContainer } from './html';
import type { DezaSection } from './types';

/**
 * The section tree, **read from the search form rather than pinned** (plan 0085,
 * section 5), so a section the chain adds appears on its own and one it drops
 * stops being crawled without a code change.
 *
 * The form renders it as a nested `<ul id='search-art'>` whose every entry is an
 * anchor carrying the code the POST wants as its `id`. The outermost entry is
 * `TODAS`, which is the chain's own name for "no section"; it is not a section
 * and does not come back from here. What comes back is its children: 9 top level
 * sections holding 62 leaves between them, measured on 2026-09-04.
 */

const ANCHOR = /<a\s+id='([^']*)'[^>]*>([\s\S]*?)<\/a>/;
const TOKEN = /<ul[\s>]|<\/ul>|<a\s+id='[^']*'[^>]*>[\s\S]*?<\/a>/g;

/** The chain's own name for the empty selection. Never a section. */
const ALL_SECTIONS_CODE = 'TODAS';

export function parseSectionTree(html: string): DezaSection[] {
  const region = sliceContainer(html, "id='search-art'", 'ul');
  if (region === null) {
    return [];
  }

  // A flat scan with an explicit stack. The markup is one `<li>` per node with
  // an optional `<ul>` of children after the anchor, so a node's depth is the
  // number of `<ul>` opens above it and nothing else has to be understood.
  const roots: DezaSection[] = [];
  const stack: DezaSection[] = [];
  let last: DezaSection | null = null;

  TOKEN.lastIndex = 0;
  for (const token of region.match(TOKEN) ?? []) {
    if (token.startsWith('</ul')) {
      stack.pop();
      last = null;
      continue;
    }
    if (token.startsWith('<ul')) {
      // The `<ul>` that follows an anchor holds that anchor's children.
      if (last) {
        stack.push(last);
        last = null;
      } else {
        // A `<ul>` with no anchor before it cannot own anything; push the
        // current parent again so the pop below stays balanced.
        stack.push(stack[stack.length - 1] ?? nowhere());
      }
      continue;
    }
    const anchor = ANCHOR.exec(token);
    if (!anchor) {
      continue;
    }
    const name = decodeText(anchor[2]);
    const parent = stack[stack.length - 1];
    const node: DezaSection = {
      code: anchor[1] === ALL_SECTIONS_CODE ? '' : anchor[1],
      name,
      path: parent && parent.code !== '' ? [...parent.path, name] : [name],
      children: [],
    };
    last = node;
    if (!parent) {
      // The `TODAS` entry itself, which is the tree's own root.
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const all = roots.find((root) => root.code === '');
  return all ? all.children : roots;
}

/** Every node with no children: what a run actually enumerates. */
export function leafSections(sections: DezaSection[]): DezaSection[] {
  const leaves: DezaSection[] = [];
  const walk = (nodes: DezaSection[]): void => {
    for (const node of nodes) {
      if (node.children.length === 0) {
        leaves.push(node);
        continue;
      }
      walk(node.children);
    }
  };
  walk(sections);
  return leaves;
}

/** A placeholder parent for markup that cannot happen; never reaches a caller. */
function nowhere(): DezaSection {
  return { code: '', name: '', path: [], children: [] };
}
