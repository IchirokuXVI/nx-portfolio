import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the operator looks at before the app exists (plan 0008, section 3).
 *
 * Asserted against the document rather than against a component, because there
 * is no component: the app blocks its first render on the environment read, so
 * anything Angular could draw appears only after the thing being waited for has
 * already settled. The spinner has to be in the static document, and this is the
 * only place a test can hold it to that.
 */

const document = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('the boot screen', () => {
  /**
   * Inside the root element, which is what makes it disappear on its own:
   * Angular replaces the contents of that element when the root component
   * renders. A spinner outside it would have to be removed by hand, and would
   * outlive the app on the day somebody forgot.
   */
  it('lives inside the element Angular takes over', () => {
    const root = document.match(
      /<app-luna-shopper-admin-root>([\s\S]*?)<\/app-luna-shopper-admin-root>/
    )?.[1];

    expect(root).toBeDefined();
    expect(root).toContain('class="boot"');
    expect(root).toContain('boot-spinner');
  });

  /** Its own styles, because the app's stylesheet has not loaded yet. */
  it('carries the styles it needs with it', () => {
    expect(document).toMatch(/<style>[\s\S]*\.boot \{/);
    expect(document).toMatch(/@keyframes boot-spin/);
  });

  /** A spinning element that announces itself, for somebody who cannot see it. */
  it('says it is a status', () => {
    expect(document).toContain('role="status"');
    expect(document).toContain('aria-live="polite"');
  });

  /** An animation somebody asked not to be shown does not run at full speed. */
  it('respects a reduced motion setting', () => {
    expect(document).toContain('prefers-reduced-motion');
  });
});
