import { writeAppLocale } from './app-locale-storage';
import {
  localeSegmentOf,
  mountDepth,
  resolveLocaleSegments,
} from './locale-segment';

const SUPPORTED = ['en', 'es'] as const;

/**
 * Every row below resolves for a visitor whose locale is `es`, which is Daniel's
 * worked example in plan 0005 D6. The resolved locale is **not** a constant: the
 * same rows land on `en` for a visitor whose stored locale is `en`, which is what
 * the last describe asserts.
 */
function resolve(path: string, mountPath = '/velista') {
  return resolveLocaleSegments({
    segments: path.split('/').filter((s) => s !== ''),
    mountPath,
    appKey: 'velista',
    supportedLocales: SUPPORTED,
    defaultLocale: 'en',
  });
}

function pathOf(result: { segments: string[] }): string {
  return '/' + result.segments.join('/');
}

describe('mountDepth', () => {
  it.each([
    ['', 0],
    ['/', 0],
    ['/velista', 1],
    ['velista', 1],
    ['/a/b', 2],
  ])('%j has depth %i', (mount, depth) => {
    expect(mountDepth(mount)).toBe(depth);
  });
});

describe('localeSegmentOf', () => {
  it('reads the segment after the mount, not index 0', () => {
    expect(localeSegmentOf(['velista', 'en', 'home'], '/velista')).toBe('en');
    expect(localeSegmentOf(['en', 'projects'], '')).toBe('en');
  });

  it('is undefined when the path stops at the mount', () => {
    expect(localeSegmentOf(['velista'], '/velista')).toBeUndefined();
  });
});

describe('resolveLocaleSegments: the four cases', () => {
  beforeEach(() => {
    // This visitor's resolved locale, which is what every "resolve" row lands on.
    writeAppLocale('velista', 'es');
  });

  it('supported and canonical: proceeds and adopts it', () => {
    const result = resolve('/velista/es/home');

    expect(result.case).toBe('supported');
    expect(result.changed).toBe(false);
    expect(result.locale).toBe('es');
  });

  it('supported, non canonical: rewrites to the canonical form and adopts it', () => {
    const result = resolve('/velista/en-US');

    expect(result.case).toBe('non-canonical');
    expect(result.changed).toBe(true);
    expect(result.locale).toBe('en');
    expect(pathOf(result)).toBe('/velista/en');
  });

  it('locale shaped but unsupported: replaces the segment', () => {
    const result = resolve('/velista/zz/home');

    expect(result.case).toBe('unsupported');
    expect(pathOf(result)).toBe('/velista/es/home');
  });

  it('not locale shaped: inserts in front of it and keeps it', () => {
    const result = resolve('/velista/home');

    expect(result.case).toBe('insert');
    expect(pathOf(result)).toBe('/velista/es/home');
  });

  it('absent: appends the resolved locale', () => {
    const result = resolve('/velista');

    expect(result.case).toBe('insert');
    expect(pathOf(result)).toBe('/velista/es');
  });
});

describe('the worked examples in plan 0005 D6', () => {
  beforeEach(() => writeAppLocale('velista', 'es'));

  it.each([
    ['/velista/es', '/velista/es', 'es'],
    // A supported URL locale outranks the stored preference, so this one is left
    // alone *and* switches the app to English. The old three row table hid that
    // behind the word "proceed".
    ['/velista/en', '/velista/en', 'en'],
    ['/velista/en/home', '/velista/en/home', 'en'],
    ['/velista/en-US', '/velista/en', 'en'],
    ['/velista/es-ES', '/velista/es', 'es'],
    ['/velista/zz', '/velista/es', 'es'],
    ['/velista/zz/home', '/velista/es/home', 'es'],
    ['/velista/zz/qwfp', '/velista/es/qwfp', 'es'],
    // Passes the locale regex, is not supported: consumed like any other.
    ['/velista/de', '/velista/es', 'es'],
    ['/velista/home', '/velista/es/home', 'es'],
    ['/velista/qwfp', '/velista/es/qwfp', 'es'],
  ])('%s becomes %s, in %s', (input, expected, locale) => {
    const result = resolve(input);

    expect(pathOf(result)).toBe(expected);
    expect(result.locale).toBe(locale);
  });

  /**
   * The two that end on a 404, and the reason the guard settles a locale rather
   * than declining. `qwfp` is not a route, so the app's own not found page renders
   * — in Spanish, which is only possible because the locale was settled first.
   */
  it('leaves an unroutable segment in place so the app can 404 in a known language', () => {
    expect(pathOf(resolve('/velista/qwfp'))).toBe('/velista/es/qwfp');
    expect(pathOf(resolve('/velista/zz/qwfp'))).toBe('/velista/es/qwfp');
  });
});

describe('the app at the site root, whose mount is empty', () => {
  beforeEach(() => writeAppLocale('velista', 'es'));

  it.each([
    ['/', '/es'],
    ['/en', '/en'],
    ['/projects', '/es/projects'],
    ['/zz/projects', '/es/projects'],
  ])('%s becomes %s', (input, expected) => {
    expect(pathOf(resolve(input, ''))).toBe(expected);
  });
});

describe('the resolved locale is the visitor’s, not a constant', () => {
  it('lands on en for a visitor who last used en', () => {
    writeAppLocale('velista', 'en');

    expect(resolve('/velista/home').locale).toBe('en');
    expect(pathOf(resolve('/velista/home'))).toBe('/velista/en/home');
  });

  it('falls back to the declared default when nothing else resolves', () => {
    writeAppLocale('velista', 'zz');

    // Neither the stored value nor jsdom's navigator locale is supported here.
    expect(resolve('/velista/home').locale).toBe('en');
  });
});
