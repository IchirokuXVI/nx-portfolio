import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What an info button may hold (admin plan 0041, section 5): a title, at most
 * four points of at most 25 words each, and at most one caution.
 *
 * A test rather than a sentence, because a limit on words is the kind of rule
 * that holds for the first three panels and is forgotten by the tenth. The
 * paragraphs these replaced grew a clause at a time, each one reasonable.
 *
 * The convention it reads: every object called `info` in the catalogue is the
 * content of one button. `title` and `caution` are what they say, and every
 * other string in it is a point. A panel whose title is the name of its screen
 * points at that key instead and holds no `title` of its own.
 */

const CATALOGUE = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'assets', 'i18n', 'en.json'),
    'utf8'
  )
) as Record<string, unknown>;

const MAX_POINTS = 4;
const MAX_WORDS = 25;

interface Panel {
  readonly path: string;
  readonly points: readonly string[];
  readonly caution: string | null;
  readonly other: readonly string[];
}

/** Every `info` object, wherever it is. `info.about` and `info.close` are the button's own words. */
function panels(node: unknown, path: string[] = []): Panel[] {
  if (typeof node !== 'object' || node === null) {
    return [];
  }

  const found: Panel[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (key === 'info' && path.length > 0) {
      const members = Object.entries(value as Record<string, unknown>);

      found.push({
        path: [...path, key].join('.'),
        points: members
          .filter(([name]) => name !== 'title' && name !== 'caution')
          .filter(([, text]) => typeof text === 'string')
          .map(([, text]) => text as string),
        caution:
          (value as Record<string, unknown>)['caution'] === undefined
            ? null
            : String((value as Record<string, unknown>)['caution']),
        other: members
          .filter(([, text]) => typeof text !== 'string')
          .map(([name]) => name),
      });
      continue;
    }

    found.push(...panels(value, [...path, key]));
  }

  return found;
}

const words = (text: string) =>
  text.split(/\s+/).filter((word) => word !== '').length;

describe('what an info button says', () => {
  it('finds the panels the catalogue holds', () => {
    // The scan is worth having only if it reads something, so the number of
    // panels is asserted rather than left to be zero without anybody noticing.
    expect(
      panels(CATALOGUE)
        .map((panel) => panel.path)
        .sort()
    ).toEqual([
      'brands.suggested.info',
      'catalog.chains.info',
      'catalog.items.info',
      'catalog.locationSections.info',
      'catalog.pricePolicies.info',
      'catalog.productPrices.info',
      'harvest.imports.info',
      'harvest.places.info',
      'harvest.postalCodes.add.info',
      'harvest.review.info',
      'harvest.setup.info',
      'harvest.shops.info',
      'harvest.sources.enabled.info',
      'harvest.sources.trusted.info',
      'harvest.switch.info',
      'people.admins.info',
      'people.baskets.info',
      'people.lists.info',
      'people.shoppers.info',
    ]);
  });

  it('holds strings and nothing nested', () => {
    expect(panels(CATALOGUE).filter((panel) => panel.other.length > 0)).toEqual(
      []
    );
  });

  it('has at least one point and at most four', () => {
    const outside = panels(CATALOGUE)
      .filter(
        (panel) => panel.points.length === 0 || panel.points.length > MAX_POINTS
      )
      .map((panel) => `${panel.path}: ${panel.points.length} points`);

    expect(outside).toEqual([]);
  });

  it('keeps every point and every caution to 25 words', () => {
    const long = panels(CATALOGUE).flatMap((panel) =>
      [...panel.points, ...(panel.caution === null ? [] : [panel.caution])]
        .filter((text) => words(text) > MAX_WORDS)
        .map((text) => `${panel.path}: ${words(text)} words: ${text}`)
    );

    expect(long).toEqual([]);
  });

  /**
   * How to use the page, and never why the gateway has or lacks a route or how
   * the data is stored (section 3). The words that gave the old paragraphs
   * away, so that one cannot come back as a point.
   */
  it('says nothing about routes, the gateway or how the data is stored', () => {
    const technical = /\b(gateway|route|endpoint|digest|column|database)\b/i;
    const named = panels(CATALOGUE).flatMap((panel) =>
      [...panel.points, ...(panel.caution === null ? [] : [panel.caution])]
        .filter((text) => technical.test(text))
        .map((text) => `${panel.path}: ${text}`)
    );

    expect(named).toEqual([]);
  });

  it('counts words the way a reader does', () => {
    expect(words('One row is the price a shopper sees at one scope.')).toBe(11);
    expect(words('  two   words ')).toBe(2);
  });
});
