import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_GROUND_COLORS } from './system-bars';

/**
 * The status bar colours are literals, because a meta tag cannot read a custom
 * property. This holds them to the stylesheet the top bar is painted from, so a palette
 * change cannot leave a status bar of the old colour above a header of the new one.
 */
describe('THEME_GROUND_COLORS', () => {
  /** `platform/src/lib` across to `ui/src/lib/styles`. */
  const styles = join(
    __dirname,
    '..',
    '..',
    '..',
    'ui',
    'src',
    'lib',
    'styles'
  );
  const primitives = readFileSync(join(styles, '_primitives.scss'), 'utf8');
  const themes = readFileSync(join(styles, '_themes.scss'), 'utf8');

  /** The primitive each theme's ground resolves to, in the order the themes appear. */
  function groundPrimitives(): string[] {
    return [
      ...themes.matchAll(/--app-surface-ground:\s*var\((--app-[\w-]+)\)/g),
    ].map((match) => match[1]);
  }

  /** A primitive's colour, as hex, whether it is written as hex or as an rgb triple. */
  function hexOf(name: string): string {
    const hex = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(primitives);
    if (hex) {
      return hex[1].toLowerCase();
    }

    const rgb = new RegExp(`${name}-rgb:\\s*(\\d+) (\\d+) (\\d+)`).exec(
      primitives
    );
    if (!rgb) {
      throw new Error(`no value for ${name} in _primitives.scss`);
    }

    return `#${rgb
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')}`;
  }

  it('matches the ground of Night and of Day', () => {
    const [night, day] = groundPrimitives();

    expect(THEME_GROUND_COLORS.night).toBe(hexOf(night));
    expect(THEME_GROUND_COLORS.day).toBe(hexOf(day));
  });
});
