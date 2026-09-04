import { isLocaleSegment } from '@portfolio/localization/rokutranslator-angular';
import { appPath } from './app-path';
import { shareUrl } from './share-url';

/**
 * The one rule this function exists for: **a shared link states no language.**
 *
 * Its counterpart `appPath` states one, because it is where to send this session. The
 * pair is worth testing together, since the difference between them is the whole of
 * the defect: a group invite sent in the sender's Spanish opened in Spanish for a
 * recipient who reads English.
 */
describe('shareUrl', () => {
  it('leaves the locale slot empty, standalone and mounted alike', () => {
    expect(shareUrl('https://velista.app', '', 'join', 'HK7M2QPD')).toBe(
      'https://velista.app/join/HK7M2QPD'
    );

    expect(shareUrl('https://ichirokuxvi.com', '/velista', 's', 'sec-1')).toBe(
      'https://ichirokuxvi.com/velista/s/sec-1'
    );
  });

  it('says nothing about the language the sender happens to be reading in', () => {
    const shared = shareUrl('https://velista.app', '', 'join', 'HK7M2QPD');

    expect(appPath('es', '', 'join', 'HK7M2QPD')).toBe('/es/join/HK7M2QPD');
    expect(shared).not.toContain('/es/');
  });

  /**
   * The guard consumes a locale shaped segment and inserts in front of anything
   * else, so a two letter first segment would be eaten rather than routed to. Both
   * segments in use today are safe, and this is the test that says so out loud
   * before a third one is added.
   */
  it('starts on a segment the locale guard will not mistake for a locale', () => {
    expect(isLocaleSegment('join')).toBe(false);
    expect(isLocaleSegment('s')).toBe(false);
  });

  it('escapes the part that came from the server', () => {
    expect(shareUrl('https://velista.app', '', 's', 'a b/c')).toBe(
      'https://velista.app/s/a%20b%2Fc'
    );
  });

  it('accepts an origin with a trailing slash, which is where one config had it', () => {
    expect(shareUrl('https://velista.app/', '', 'join', 'CODE')).toBe(
      'https://velista.app/join/CODE'
    );
  });
});
