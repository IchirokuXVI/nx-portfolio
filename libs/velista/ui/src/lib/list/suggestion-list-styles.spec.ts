import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two targets of velista `0108` that live in the stylesheet alone, read from
 * the source because jsdom lays nothing out and applies no component styles. The
 * rendered sizes and colours are checked in a browser; this keeps the rules from
 * quietly coming back.
 */
const SCSS = readFileSync(join(__dirname, 'suggestion-list.scss'), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(SCSS);
  if (found === null) {
    throw new Error(`no rule for ${selector}`);
  }
  return found[2];
}

describe('suggestion-list.scss', () => {
  it('sizes the composer’s panel to its cards, with no floor on its height (target 2)', () => {
    const panel = rule('.panel');

    expect(panel).not.toMatch(/min-height/);
    expect(panel).toMatch(/max-height/);
    // The bottom anchoring margin only ever did anything against a floor.
    expect(SCSS).not.toMatch(/\.panel\s*>\s*:first-child/);
  });

  it('draws "already on your list" as a label in the attention pair (target 3)', () => {
    const label = rule('.already-h');

    expect(label).toMatch(/background:\s*var\(--app-status-attention-bg\)/);
    expect(label).toMatch(/color:\s*var\(--app-status-attention-fg\)/);
    expect(label).toMatch(/border-radius/);
  });
});
