import { APP_THEMES, AppTheme } from '@portfolio/velista/models';
import { resolve } from 'path';
import { compile } from 'sass';

/**
 * Plan 0002, acceptance criterion 6: *a contrast check has been run over both
 * themes for every token pair that is actually used together.*
 *
 * This is that check, and it runs against the **compiled stylesheet** rather than
 * against a palette re-typed into TypeScript. A second copy of the ramps would
 * drift from the first, and a contrast test that reassures you about values the
 * app no longer uses is worse than no test.
 *
 * The floor is section 11's: 4.5:1 for text, 3:1 for large text and for the
 * interactive borders that identify a control. What is deliberately **not**
 * checked is the decorative layer: hairline row separators, and the status chip
 * fills and outlines. Those carry no meaning on their own: section 11 requires
 * every line status to have an icon or a text label alongside its colour, which is
 * also what covers a colour blind user reading a red and green status list. The
 * text inside the chip is checked, over the chip's own fill.
 */

const STYLESHEET = resolve(__dirname, '../layout/app-layout.scss');

/** WCAG's floors, named so a failure message says which one it was. */
const TEXT = 4.5;
const NON_TEXT = 3;

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Every custom property the stylesheet declares, split by the selector it was
 * declared under: the app root, and one block per theme.
 */
type Declarations = Map<string, string>;

function declarationsFor(css: string, selector: string): Declarations {
  const declarations: Declarations = new Map();
  // Every block opened by exactly this selector. There is more than one per
  // selector: `app-contrast-preferences` emits a second inside a media query, and
  // that one is a preference rather than the resting value, so it is skipped by
  // taking only blocks that are not nested inside an at-rule.
  const pattern = new RegExp(
    `(^|\\})\\s*${selector.replace(/[.()]/g, '\\$&')}\\s*\\{([^{}]*)\\}`,
    'g'
  );
  for (const match of css.matchAll(pattern)) {
    for (const line of match[2].split(';')) {
      const [name, ...rest] = line.split(':');
      if (name?.trim().startsWith('--')) {
        declarations.set(name.trim(), rest.join(':').trim());
      }
    }
  }
  return declarations;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }: Rgba): number {
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/** Lays a possibly translucent colour over an opaque one. */
function over(top: Rgba, bottom: Rgba): Rgba {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

function contrast(foreground: Rgba, background: Rgba): number {
  const composited = over(foreground, background);
  const [lighter, darker] = [luminance(composited), luminance(background)].sort(
    (a, b) => b - a
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe('contrast', () => {
  const css = compile(STYLESHEET).css;
  const base = declarationsFor(css, ':host');
  const themes = new Map<AppTheme, Declarations>(
    APP_THEMES.map((theme) => [
      theme,
      declarationsFor(css, `:host(.theme-${theme})`),
    ])
  );

  /** Resolves a token to real channels, following `var()` and applying alpha. */
  function colour(token: string, theme: AppTheme): Rgba {
    const value = themes.get(theme)?.get(token) ?? base.get(token);
    if (value === undefined) {
      throw new Error(`${token} is not declared in theme ${theme}`);
    }

    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    if (alias) {
      return colour(alias[1], theme);
    }

    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }

    // `rgb(var(--x-rgb))` and `rgb(var(--x-rgb) / 26%)`, the form every tint and
    // hairline takes so that no second literal is ever written down.
    const channelsFromToken =
      /^rgb\(\s*var\((--[\w-]+)\)\s*(?:\/\s*([\d.]+)%\s*)?\)$/.exec(value);
    if (channelsFromToken) {
      const raw = base.get(channelsFromToken[1]);
      const parts = raw?.split(/\s+/).map(Number);
      if (!parts || parts.length !== 3 || parts.some(Number.isNaN)) {
        throw new Error(`${channelsFromToken[1]} is not a channel triplet`);
      }
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: channelsFromToken[2] ? Number(channelsFromToken[2]) / 100 : 1,
      };
    }

    throw new Error(`cannot read ${token} in theme ${theme}: ${value}`);
  }

  function ratio(fg: string, bg: string, theme: AppTheme): number {
    return contrast(colour(fg, theme), colour(bg, theme));
  }

  it('parsed the compiled stylesheet, so a silent miss cannot pass', () => {
    expect(base.size).toBeGreaterThan(30);
    for (const theme of APP_THEMES) {
      expect(themes.get(theme)?.get('--app-surface-ground')).toBeDefined();
    }
  });

  describe.each(APP_THEMES)('%s', (theme) => {
    const surfaces = [
      '--app-surface-ground',
      '--app-surface-raised',
      '--app-surface-overlay',
      '--app-surface-sunken',
    ];

    describe.each(surfaces)('text on %s', (surface) => {
      it.each([
        '--app-text-primary',
        '--app-text-secondary',
        '--app-text-muted',
      ])(`%s reaches ${TEXT}:1`, (text) => {
        expect(ratio(text, surface, theme)).toBeGreaterThanOrEqual(TEXT);
      });
    });

    // A quiet action is text and nothing else, so it carries a text floor rather
    // than a control one. This is the pair that forces amber-800 on Day: the
    // amber-500 that fills the primary button is 1.9:1 as text on white.
    it.each(['--app-surface-ground', '--app-surface-raised'])(
      `the quiet action reaches ${TEXT}:1 on %s`,
      (surface) => {
        expect(
          ratio('--app-action-quiet-fg', surface, theme)
        ).toBeGreaterThanOrEqual(TEXT);
      }
    );

    // Rule T2: never place white or light text on an action fill. `--app-action-fg`
    // exists so this cannot be gotten wrong by accident, and this is what proves
    // it across every state of the button, not just its resting one.
    it.each([
      '--app-action-bg',
      '--app-action-bg-hover',
      '--app-action-bg-pressed',
    ])(`the action label reaches ${TEXT}:1 on %s`, (fill) => {
      expect(ratio('--app-action-fg', fill, theme)).toBeGreaterThanOrEqual(
        TEXT
      );
      expect(ratio('--app-text-on-action', fill, theme)).toBeGreaterThanOrEqual(
        TEXT
      );
    });

    // Status text sits inside its own chip, so the fill is the background it has
    // to clear, not the surface underneath. Both are checked because a chip is
    // used on a card and on the page ground.
    const statuses = ['success', 'danger', 'attention', 'info', 'neutral'];
    describe.each(statuses)('the %s status', (status) => {
      it.each(['--app-surface-ground', '--app-surface-raised'])(
        `is readable in its chip on %s`,
        (surface) => {
          const chip = over(
            colour(`--app-status-${status}-bg`, theme),
            colour(surface, theme)
          );
          expect(
            contrast(colour(`--app-status-${status}-fg`, theme), chip)
          ).toBeGreaterThanOrEqual(TEXT);
        }
      );
    });

    // The two things WCAG's 3:1 non-text floor is actually about here: the outline
    // that identifies an input, and the ring that shows where the keyboard is.
    it.each([
      '--app-surface-ground',
      '--app-surface-raised',
      '--app-surface-sunken',
    ])(`a strong border reaches ${NON_TEXT}:1 on %s`, (surface) => {
      expect(
        ratio('--app-border-strong', surface, theme)
      ).toBeGreaterThanOrEqual(NON_TEXT);
    });

    // The ring is checked against the **surfaces**, not against the fill of the
    // control it surrounds, and `--app-focus-ring-offset` is what makes that the
    // right pair: the ring is drawn wholly outside the control, on the surface
    // behind it. No single colour can clear 3:1 against both a near black surface
    // and the amber primary button, since the two sit on opposite sides of every
    // mid-tone, so a ring drawn tight to that button would be unfixable. The
    // offset is load bearing rather than cosmetic, which is why it has a test of
    // its own below.
    it.each([
      '--app-surface-ground',
      '--app-surface-raised',
      '--app-surface-sunken',
    ])(`the focus ring reaches ${NON_TEXT}:1 on %s`, (surface) => {
      expect(ratio('--app-focus-ring', surface, theme)).toBeGreaterThanOrEqual(
        NON_TEXT
      );
    });
  });

  it('offsets the focus ring off the control it surrounds', () => {
    // Section 11 makes the ring a token so it cannot be quietly removed. Setting
    // the offset to zero would remove it just as effectively on the one control
    // that matters most, so it is pinned here too.
    const offset = base.get('--app-focus-ring-offset');
    expect(offset).toBeDefined();
    expect(parseFloat(offset as string)).toBeGreaterThan(0);
    expect(
      parseFloat(base.get('--app-focus-ring-width') as string)
    ).toBeGreaterThan(0);
  });
});
