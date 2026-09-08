import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The global control rule, put in front of a test the way a browser puts it in
 * front of an operator (plan 0018, section 2).
 *
 * A component's `styles` reach a spec on their own; the app's stylesheet does
 * not, because nothing in a `TestBed` loads it. So a screen that draws browser
 * default controls and a screen that draws styled ones look identical to a spec
 * that mounts the component and asks, which is how four screens shipped with a
 * `<select>` the browser styled and an `<input>` 21 pixels tall.
 *
 * This reads the rule out of `apps/luna-shopper-admin/src/styles.scss`, which is
 * the file the browser actually gets, and applies it to the test document. A
 * copy of the declarations written here instead would pass with the rule
 * deleted.
 */

const STYLES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'apps',
  'luna-shopper-admin',
  'src',
  'styles.scss'
);

/** The `button, input, select` rule, selector and body, as it is written. */
export function controlBaseRule(): { selector: string; body: string } {
  const text = readFileSync(STYLES, 'utf8');
  const found = /(button,\s*input,\s*select)\s*\{([^}]*)\}/.exec(text);

  if (!found) {
    throw new Error(
      'apps/luna-shopper-admin/src/styles.scss no longer carries the ' +
        '`button, input, select` rule that every screen depends on'
    );
  }

  return { selector: found[1].replace(/\s+/g, ' '), body: found[2] };
}

/** Every property the rule sets, in the order it sets them. */
export function controlBaseProperties(): readonly string[] {
  return [...controlBaseRule().body.matchAll(/^\s*([a-z-]+):/gm)].map(
    (found) => found[1]
  );
}

/**
 * The rule, in the test document, until it is taken out again.
 *
 * Custom properties are left as they are written. jsdom does not resolve `var()`
 * in a computed style, so the declarations that carry a token are checked by
 * reading the rule; the two that carry a literal, and are the two an operator
 * feels, come back from `getComputedStyle`: the 44 pixel touch target and the
 * font size that stops iOS Safari zooming the viewport on focus.
 */
export function applyControlBase(): () => void {
  const { selector, body } = controlBaseRule();
  const style = document.createElement('style');

  style.textContent = `${selector} {${body}}`;
  document.head.append(style);

  return () => style.remove();
}
