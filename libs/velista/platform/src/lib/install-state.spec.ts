import { installGuideFor } from './install-state';

/**
 * Plan 0033, section 8: real user agent strings, and the iPad decided explicitly.
 *
 * The strings below are copied from real browsers rather than shortened, because the
 * ordering inside `installGuideFor` is the part that breaks: every Chromium brand
 * carries `chrome`, Edge carries `safari` as well, and a trimmed fixture would keep
 * passing after somebody reorders the reads.
 */
describe('installGuideFor', () => {
  const IPHONE_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const IPHONE_CHROME =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1';
  const ANDROID_CHROME =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';
  const ANDROID_FIREFOX =
    'Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0';
  const DESKTOP_CHROME =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
  const DESKTOP_EDGE =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.2420.65';
  const DESKTOP_FIREFOX =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';
  const MAC_SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

  it('sends every browser on iOS to the Share sheet', () => {
    // The engine decides this and the brand does not: every browser on iOS is
    // Safari's engine, and every one of them installs the same way.
    expect(installGuideFor(IPHONE_SAFARI)).toBe('ios-safari');
    expect(installGuideFor(IPHONE_CHROME)).toBe('ios-safari');
  });

  it('sends Android to the browser menu, whatever the brand', () => {
    expect(installGuideFor(ANDROID_CHROME)).toBe('android-menu');
    expect(installGuideFor(ANDROID_FIREFOX)).toBe('android-menu');
  });

  it('sends desktop Chromium to the address bar, Edge included', () => {
    // Edge's string ends in `Edg/`, and carries `chrome` and `safari` before it.
    expect(installGuideFor(DESKTOP_CHROME)).toBe('desktop-chromium');
    expect(installGuideFor(DESKTOP_EDGE)).toBe('desktop-chromium');
  });

  it('sends desktop Firefox to the one frame that says no', () => {
    expect(installGuideFor(DESKTOP_FIREFOX)).toBe('desktop-firefox');
  });

  it('sends Safari on a Mac to the File menu', () => {
    expect(installGuideFor(MAC_SAFARI)).toBe('desktop-safari');
  });

  /**
   * The case section 8 asks to decide rather than let fall out.
   *
   * Since iPadOS 13 an iPad's default user agent is Safari's Macintosh one, with no
   * `iPad` anywhere in it, so on the string alone it is a Mac and gets File then Add
   * to Dock, which that device does not have. The touch points are the only ordinary
   * signal that separates them, and no Mac reports more than one.
   */
  it('treats a Macintosh that reports touch points as an iPad', () => {
    expect(installGuideFor(MAC_SAFARI, { maxTouchPoints: 5 })).toBe(
      'ios-safari'
    );
    expect(installGuideFor(MAC_SAFARI, { maxTouchPoints: 0 })).toBe(
      'desktop-safari'
    );
  });

  it('falls back to the browser menu for anything unrecognised', () => {
    // The most generic wording of the four, and true of nearly every browser menu.
    expect(installGuideFor('')).toBe('android-menu');
    expect(installGuideFor('SomeNewBrowser/1.0')).toBe('android-menu');
  });
});
