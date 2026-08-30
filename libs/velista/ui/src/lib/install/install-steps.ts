import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { InstallGuide } from '@portfolio/velista/platform';
import { EllipsisIcon, InstallIcon, ShareIosIcon } from '../icons/icons';

/** One step, as the template needs it: a key, and the glyph the words name. */
interface GuideStep {
  readonly key: string;
  readonly glyph: 'share' | 'menu' | 'install' | null;
}

/**
 * How to install it by hand, in the browser this is being read in (plan 0033, D9).
 *
 * **The steps are the floor** (D3). This component is what the install page draws
 * before anything has arrived from the browser, and what it keeps behind a disclosure
 * once a prompt has, because on Safari and on Firefox no prompt ever comes and these
 * are the only method there is.
 *
 * Which guide to draw is decided by the container, from `installGuideFor`. This
 * component takes the answer and nothing else: rule I3 says a user agent read chooses
 * the words on this card and never whether a button exists elsewhere.
 *
 * An `<ol>`, so the count and each step's position are announced without the copy
 * having to say *step 2 of 3* (section 7). The glyphs are `aria-hidden` and every step
 * names its control in words, because the person these are written for is exactly the
 * person who cannot see the glyph.
 */
@Component({
  selector: 'lib-install-steps',
  imports: [RokuTranslatorPipe, EllipsisIcon, InstallIcon, ShareIosIcon],
  templateUrl: './install-steps.html',
  styleUrl: './install-steps.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallSteps {
  readonly guide = input.required<InstallGuide>();

  /** The translation prefix for this guide. `ios-safari` becomes `iosSafari`. */
  protected readonly prefix = computed(
    () => `install.guide.${camelCase(this.guide())}`
  );

  /**
   * Desktop Firefox, which is the one member of the union that is not a guide.
   *
   * It cannot keep a site as an app at all, so there are no steps to number. The
   * template draws one sentence naming the browsers on the same machine that can, and
   * a bookmark instead, because a frame that only says no is not worth a screen. It is
   * the only place in this design that says something is not possible.
   */
  protected readonly impossible = computed(
    () => this.guide() === 'desktop-firefox'
  );

  /**
   * The three steps, with the glyph each one's words name.
   *
   * A structure rather than four templates: the geometry of a numbered step is written
   * once, and the only thing that varies between the guides is the copy and one glyph.
   */
  protected readonly steps = computed<readonly GuideStep[]>(() => {
    const prefix = this.prefix();
    const glyphs = GLYPHS[this.guide()];
    return glyphs.map((glyph, index) => ({
      key: `${prefix}.step${index + 1}`,
      glyph,
    }));
  });
}

/**
 * Which step of each guide carries a glyph, and which.
 *
 * Only the first step of three names a control that is a picture rather than a word:
 * Safari's Share button, the browser menu's three dots, and Chromium's install icon at
 * the end of the address bar. The rest are menu items with names, and a glyph beside a
 * name that already reads correctly is noise.
 */
const GLYPHS: Record<InstallGuide, readonly GuideStep['glyph'][]> = {
  'ios-safari': ['share', null, null],
  'android-menu': ['menu', null, null],
  'desktop-chromium': ['install', null, null],
  'desktop-safari': [null, null, null],
  // No numbered steps at all. See `impossible`.
  'desktop-firefox': [],
};

/** `ios-safari` to `iosSafari`, so a guide names its own translation subtree. */
function camelCase(guide: InstallGuide): string {
  return guide.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase()
  );
}
