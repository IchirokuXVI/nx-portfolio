import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The ratios the tokens were chosen for, computed rather than copied (plan
 * 0018, section 1.1; admin plan 0041, section 2).
 *
 * A pair once measured 1.14 to 1 and shipped, so the numbers written beside the
 * tokens are the whole of the reasoning, and a number in a comment is a number
 * nothing checks. An accent moved half a step lighter, or a wash darkened to
 * look better in a screenshot, breaks one of these. It fails here rather than
 * in front of an operator.
 *
 * WCAG 2.1's relative luminance and contrast formulas, which is what 4.5 to 1
 * means. Every pair here is text at an ordinary size, so 4.5 is the bar and
 * not 3.
 */

const TOKENS = readFileSync(join(__dirname, '_tokens.scss'), 'utf8');

/** The smallest ratio that counts as readable, for text at these sizes. */
const READABLE = 4.5;

/** The smallest ratio for something that is not text: the edge of a control. */
const OUTLINE = 3;

/** What plan 0041 asks of an entry at rest on its rail. */
const NAVIGATION = 6.5;

/**
 * A token's hex value, from the **first** block that declares it.
 *
 * The first is the resting one, which is the value the root mixin carries and
 * the one an app that could not establish its deployment wears. A deployment's
 * value is read by handing this the deployment's own block.
 */
function token(name: string, within = TOKENS): string {
  const found = new RegExp(`${name}:\\s*(#[0-9a-f]{6});`).exec(within);

  if (!found) {
    throw new Error(`${name} is not declared as a hex colour`);
  }

  return found[1];
}

/** One deployment's block, so its navigation is read and not the resting one. */
function deployment(name: string): string {
  const opened = TOKENS.indexOf(`&[data-deployment='${name}']`);

  if (opened === -1) {
    throw new Error(`there is no block for the ${name} deployment`);
  }

  return TOKENS.slice(opened, TOKENS.indexOf('}', opened));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
    );

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

const DEPLOYMENTS = ['production', 'staging', 'development'] as const;

/** Every pair on the page: an ink and the surface or the wash it is drawn on. */
function pageRatios(): Record<string, number> {
  return {
    ink: contrast(token('--admin-ink'), token('--admin-surface-raised')),
    inkOnGround: contrast(token('--admin-ink'), token('--admin-surface')),
    muted: contrast(
      token('--admin-ink-muted'),
      token('--admin-surface-raised')
    ),
    mutedOnGround: contrast(
      token('--admin-ink-muted'),
      token('--admin-surface')
    ),
    // A filled control: the primary button.
    accentInk: contrast(token('--admin-accent-ink'), token('--admin-accent')),
    // The accent as text: a link, on a panel and on the ground.
    accent: contrast(token('--admin-accent'), token('--admin-surface-raised')),
    accentOnGround: contrast(token('--admin-accent'), token('--admin-surface')),
    // The three tinted boxes, each with the ink made for it.
    accentOnWash: contrast(
      token('--admin-accent-on-wash'),
      token('--admin-accent-wash')
    ),
    neutralOnWash: contrast(
      token('--admin-neutral-on-wash'),
      token('--admin-neutral-wash')
    ),
    waitingOnWash: contrast(
      token('--admin-waiting-on-wash'),
      token('--admin-waiting-wash')
    ),
    // `--admin-danger-on-wash` is the solid danger colour.
    dangerOnWash: contrast(
      token('--admin-danger'),
      token('--admin-danger-wash')
    ),
    dangerInk: contrast(token('--admin-danger-ink'), token('--admin-danger')),
    // A danger sentence with no box of its own sits on the raised surface.
    dangerOnSurface: contrast(
      token('--admin-danger'),
      token('--admin-surface-raised')
    ),
    // A selected row is the accent wash with ordinary text on it.
    inkOnAccentWash: contrast(
      token('--admin-ink'),
      token('--admin-accent-wash')
    ),
    mutedOnAccentWash: contrast(
      token('--admin-ink-muted'),
      token('--admin-accent-wash')
    ),
  };
}

/** An entry at rest on its rail, for the three deployments and for none. */
function railRatios(): Record<string, number> {
  const ratios: Record<string, number> = {
    none: contrast(token('--admin-nav-ink'), token('--admin-nav')),
  };

  for (const name of DEPLOYMENTS) {
    ratios[name] = contrast(
      token('--admin-nav-ink', deployment(name)),
      token('--admin-nav', deployment(name))
    );
  }

  return ratios;
}

/** The current entry: white on the lighter navigation colour. */
function currentRatios(): Record<string, number> {
  const ink = token('--admin-nav-current-ink');
  const ratios: Record<string, number> = {
    none: contrast(ink, token('--admin-nav-current')),
  };

  for (const name of DEPLOYMENTS) {
    ratios[name] = contrast(
      ink,
      token('--admin-nav-current', deployment(name))
    );
  }

  return ratios;
}

describe('an ink is readable on what it is drawn on', () => {
  it('measures what the token block says it measures, on the page', () => {
    expect(pageRatios()).toEqual({
      ink: 17.51,
      inkOnGround: 16.3,
      muted: 6.6,
      mutedOnGround: 6.14,
      accentInk: 6.48,
      accent: 6.31,
      accentOnGround: 5.87,
      accentOnWash: 7.67,
      neutralOnWash: 8.35,
      waitingOnWash: 6.47,
      dangerOnWash: 5.62,
      dangerInk: 6.53,
      dangerOnSurface: 6.36,
      inkOnAccentWash: 15.47,
      mutedOnAccentWash: 5.83,
    });
  });

  it('clears 4.5 to 1 in every one of them', () => {
    for (const [pair, ratio] of Object.entries(pageRatios())) {
      expect([pair, ratio >= READABLE]).toEqual([pair, true]);
    }
  });

  /**
   * The four pairs plan 0041 adds: the rail and the bar take the colour of the
   * deployment, and the label of an entry has to read on each of them.
   */
  it('measures an entry at rest on each of the four rails', () => {
    expect(railRatios()).toEqual({
      none: 9.26,
      production: 8.6,
      staging: 6.86,
      development: 8.41,
    });
  });

  it('clears 6.5 to 1 on every rail', () => {
    for (const [rail, ratio] of Object.entries(railRatios())) {
      expect([rail, ratio >= NAVIGATION]).toEqual([rail, true]);
    }
  });

  it('reads the current entry on each of the four rails', () => {
    expect(currentRatios()).toEqual({
      none: 12.78,
      production: 8.26,
      staging: 5.75,
      development: 7.6,
    });

    for (const [rail, ratio] of Object.entries(currentRatios())) {
      expect([rail, ratio >= READABLE]).toEqual([rail, true]);
    }
  });

  /**
   * The count on an entry and the name of the deployment are both the ordinary
   * ink on the near white, which is why one token serves every rail: neither
   * touches the colour under it.
   */
  it('draws the count and the deployment name in a pair no rail can break', () => {
    expect(contrast(token('--admin-ink'), token('--admin-count'))).toBe(17.51);
  });

  /**
   * The deployment sets the navigation and nothing else. The accent used to
   * follow it, which made the primary button red in production; a deployment
   * block that sets the accent again would bring that back.
   */
  it('lets a deployment set the three navigation tokens and nothing else', () => {
    for (const name of DEPLOYMENTS) {
      const declared = [
        ...deployment(name).matchAll(/(--admin-[a-z0-9-]+):/g),
      ].map((found) => found[1]);

      expect([name, declared]).toEqual([
        name,
        ['--admin-nav', '--admin-nav-ink', '--admin-nav-current'],
      ]);
    }
  });

  /**
   * Amber on the page means a person must decide, and there is one amber. The
   * violet that used to mark a waiting queue is gone, and a rule that still
   * names it would draw with no colour at all.
   */
  it('has retired the attention pair', () => {
    expect(TOKENS).not.toContain('--admin-status-attention');
  });

  /**
   * The outline of a control (admin plan 0052, section 4). It is not text, so
   * its bar is 3 to 1, and it is measured against the raised surface because
   * that is what every control is filled with: the edge always has that fill
   * on its inner side, wherever the control stands.
   *
   * It was `#c3c8c0`, which is 1.66 to 1 there: a field read as a pale box.
   */
  it('draws the outline of a control at 3 to 1 on the fill of a control', () => {
    const outline = contrast(
      token('--admin-border-strong'),
      token('--admin-surface-raised')
    );

    expect(outline).toBeGreaterThanOrEqual(OUTLINE);
  });

  /**
   * The same outline against the ground of the page, which is the outer side
   * of a control in a filter bar. The plan asks for 3 to 1 there too, so the
   * edge reads from both of its sides.
   */
  it('draws the outline of a control at 3 to 1 on the ground', () => {
    expect(
      contrast(token('--admin-border-strong'), token('--admin-surface'))
    ).toBeGreaterThanOrEqual(OUTLINE);
  });

  /** A line between rows and the edge of a panel stay light: they are not controls. */
  it('keeps the line of a panel lighter than the outline of a control', () => {
    expect(
      contrast(token('--admin-border'), token('--admin-surface-raised'))
    ).toBeLessThan(
      contrast(token('--admin-border-strong'), token('--admin-surface-raised'))
    );
  });

  /**
   * The mistake the `-on-wash` inks exist to prevent, measured: the ink of the
   * solid accent on the accent's wash is white on a pale box.
   */
  it('measures the ink of a solid on its wash as invisible', () => {
    expect(
      contrast(token('--admin-accent-ink'), token('--admin-accent-wash'))
    ).toBeLessThan(1.3);
  });
});
