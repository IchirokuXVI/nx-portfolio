/**
 * What this browser can be asked to do about installing (plan 0033 D2).
 *
 * Three members, and there is deliberately no fourth.
 *
 * `unknown` is rejected because it would have to be rendered, and the only honest way
 * to render it is a spinner over a question the browser may never answer: nothing asks
 * whether installing is possible, a page can only listen for `beforeinstallprompt` and
 * react if it arrives (section 2.1).
 *
 * `unsupported` is rejected because it is not a state of the app, it is a property of
 * one browser on one platform, and what somebody needs in that case is not the word no,
 * it is the steps. Both collapse into `manual`, which is the state that always has
 * something to show.
 */
export type InstallState =
  /** Running inside the installed app, or known to have installed it. */
  | 'installed'
  /** A prompt is in hand. One press installs, with no instructions to read. */
  | 'ready'
  /** No prompt. The browser can still do it, by hand, and the page says how. */
  | 'manual';

/**
 * Which set of steps to draw.
 *
 * These name **menus**, not capabilities, and that is the whole reason a user agent
 * read is legitimate here and nowhere else (rule I3). Whether a button exists is
 * `InstallState`, which never consults this.
 *
 * `desktop-firefox` is the one member that is not a guide: desktop Firefox cannot keep
 * a site as an app at all. It is the only place in this design that says something is
 * not possible, and its frame still ends with something to do (D9).
 */
export type InstallGuide =
  | 'ios-safari'
  | 'android-menu'
  | 'desktop-chromium'
  | 'desktop-safari'
  | 'desktop-firefox';

/**
 * The steps for the browser this is being read in.
 *
 * Pure, and the home of D9's test cases. It takes `standalone` as well as the user
 * agent for one case that cannot be read out of the string: **an iPad reports itself as
 * a Mac.** Since iPadOS 13 the default user agent on an iPad is Safari's Macintosh
 * one, with no `iPad` in it, and the only ordinary signal that separates the two is a
 * touch screen. Section 8 asks for that case to be decided rather than left to fall
 * out, so it is decided here: a Macintosh user agent that also reports touch points is
 * treated as an iPad and gets the Share steps, which are the ones that work there. The
 * cost of being wrong is a Mac with a touch display reading iPad steps, which no Mac
 * has; the cost the other way is every iPad reading a File menu it does not have.
 *
 * Anything unrecognised falls to `android-menu`, whose wording is the most generic of
 * the four and is true of nearly every browser menu.
 */
export function installGuideFor(
  userAgent: string,
  options: InstallGuideOptions = {}
): InstallGuide {
  const ua = userAgent.toLowerCase();

  // Every browser on iOS is Safari's engine, and every one of them installs through
  // the Share sheet, so the engine decides this and the brand does not: Chrome on an
  // iPhone (`crios`) gets the same three steps as Safari.
  const isIosDevice = /iphone|ipod|ipad/.test(ua);
  const isIpadPretendingToBeAMac =
    /macintosh/.test(ua) && (options.maxTouchPoints ?? 0) > 1;
  if (isIosDevice || isIpadPretendingToBeAMac) {
    return 'ios-safari';
  }

  if (/android/.test(ua)) {
    return 'android-menu';
  }

  // Order matters below, and only here. Every Chromium brand carries `chrome` in its
  // user agent, and Edge carries `safari` as well, so the two specific reads have to
  // come before the general ones.
  if (/firefox|fxios/.test(ua)) {
    return 'desktop-firefox';
  }

  if (/edg\//.test(ua) || /chrome|chromium|crios/.test(ua)) {
    return 'desktop-chromium';
  }

  if (/safari/.test(ua)) {
    return 'desktop-safari';
  }

  return 'android-menu';
}

/** What `installGuideFor` needs beyond the user agent string. */
export interface InstallGuideOptions {
  /**
   * `navigator.maxTouchPoints`. Read for exactly one decision, the iPad that reports
   * itself as a Mac, and for nothing else.
   */
  readonly maxTouchPoints?: number;
}
