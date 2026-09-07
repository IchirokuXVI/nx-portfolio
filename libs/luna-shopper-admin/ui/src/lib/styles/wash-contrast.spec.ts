import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The ratios the `-on-wash` inks were chosen for, computed rather than copied
 * (plan 0018, section 1.1).
 *
 * The pair that made these tokens necessary measured 1.14 to 1 and shipped, so
 * the numbers written beside them are the whole of the reasoning, and a number
 * in a comment is a number nothing checks. An accent moved half a step darker,
 * or a wash lightened to look better in a screenshot, breaks one of these. It
 * fails here rather than in front of an operator.
 *
 * WCAG 2.1's relative luminance and contrast formulas, which is what 4.5 to 1
 * means. Badge text and list text, so 4.5 is the bar and not 3.
 */

const TOKENS = readFileSync(join(__dirname, '_tokens.scss'), 'utf8');

/** The smallest ratio that counts as readable, for text at these sizes. */
const READABLE = 4.5;

/**
 * A token's hex value, from the **first** block that declares it.
 *
 * The first is the resting one, which is the value the root mixin carries and
 * the one an app that could not establish its environment wears. A deployment's
 * value is read by handing this the deployment's own block.
 */
function token(name: string, within = TOKENS): string {
  const found = new RegExp(`${name}:\\s*(#[0-9a-f]{6});`).exec(within);

  if (!found) {
    throw new Error(`${name} is not declared as a hex colour`);
  }

  return found[1];
}

/** One deployment's block, so its accent is read and not the resting one. */
function deployment(name: string): string {
  const opened = TOKENS.indexOf(`&[data-deployment='${name}']`);

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

/** Every pair an `-on-wash` ink is actually drawn in. */
function ratios(): Record<string, number> {
  const accentOn = (name: string) =>
    contrast(
      token('--admin-accent', deployment(name)),
      token('--admin-accent-wash', deployment(name))
    );

  return {
    // `--admin-accent-on-wash: var(--admin-accent)` in a named deployment.
    production: accentOn('production'),
    staging: accentOn('staging'),
    development: accentOn('development'),
    // The resting one, where the ink is the muted grey and not the accent.
    resting: contrast(
      token('--admin-accent-on-wash'),
      token('--admin-accent-wash')
    ),
    danger: contrast(token('--admin-danger'), token('--admin-danger-wash')),
    attention: contrast(
      token('--admin-status-attention'),
      token('--admin-status-attention-wash')
    ),
    // The four rules of section 1 that keep a transparent background sit on the
    // raised surface, so that is the pair they are read against.
    dangerOnSurface: contrast(
      token('--admin-danger'),
      token('--admin-surface-raised')
    ),
  };
}

describe('an ink on a wash is readable', () => {
  it('measures what the token block says it measures', () => {
    expect(ratios()).toEqual({
      production: 5.62,
      staging: 5.38,
      development: 5.99,
      resting: 5.52,
      danger: 5.62,
      attention: 7.4,
      dangerOnSurface: 6.53,
    });
  });

  it('clears 4.5 to 1 in every one of them', () => {
    for (const [pair, ratio] of Object.entries(ratios())) {
      expect([pair, ratio >= READABLE]).toEqual([pair, true]);
    }
  });

  /**
   * The resting accent is the reason `--admin-accent-on-wash` is a grey rather
   * than `var(--admin-accent)` like the other two: it is the one value that does
   * not clear the bar on its own wash, and an app that could not say which
   * environment it is in is exactly the app nobody is watching.
   */
  it('records why the resting ink is not the resting accent', () => {
    expect(
      contrast(token('--admin-accent'), token('--admin-accent-wash'))
    ).toBeLessThan(READABLE);
    expect(token('--admin-accent-on-wash')).toBe(token('--admin-ink-muted'));
  });

  /**
   * The state this whole plan is about, so the measurement that condemns it is
   * here and not only in the prose.
   */
  it('measures the pair that was there before as invisible', () => {
    expect(
      contrast(
        token('--admin-accent-ink'),
        token('--admin-accent-wash', deployment('development'))
      )
    ).toBeLessThan(1.2);
  });
});
