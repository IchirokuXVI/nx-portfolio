import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The targets of velista `0108` and `0113` that live in the stylesheet alone, read from
 * the source because jsdom lays nothing out and applies no component styles. The
 * rendered sizes and colours are checked in a browser; this keeps the rules from
 * quietly coming back.
 */
const SCSS = readFileSync(
  join(__dirname, 'suggestion-list.scss'),
  'utf8'
).replace(/\r\n/g, '\n');

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
  it('gives the cards no panel of their own: they scroll with the page (velista 0117)', () => {
    expect(SCSS).not.toMatch(/(^|\n)\.panel\s*\{/);
    expect(SCSS).not.toContain('--app-viewport');
  });

  it('keeps a card’s touch targets inside the card, at their full size (velista 0113)', () => {
    // Centred on the pill, the 44px target hung 5 to 7px below the card's last
    // row, and the panel had that much to scroll whatever its card count. It grows
    // upward from inside the card's bottom edge instead. Measured in a browser at 390px:
    // one, two and three cards give a panel whose scrollHeight is its clientHeight,
    // and every target is 44px tall.
    const target = rule('.chains::after,\n.reveal::after,\n.details::after');

    expect(target).not.toMatch(/inset-block:/);
    expect(target).toMatch(/bottom:\s*calc\(var\(--app-space-2\) \* -1\)/);
    expect(target).toMatch(/height:\s*var\(--app-touch-target\)/);
  });

  it('draws "already on your list" as a label in the attention pair (target 3)', () => {
    const label = rule('.already-h');

    expect(label).toMatch(/background:\s*var\(--app-status-attention-bg\)/);
    expect(label).toMatch(/color:\s*var\(--app-status-attention-fg\)/);
    expect(label).toMatch(/border-radius/);
  });
});
