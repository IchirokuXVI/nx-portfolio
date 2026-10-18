import { safeReturnUrl } from './return-url';

/**
 * Where signing in may send somebody next (velista `0154`, constraint 1).
 *
 * A relative path inside the app, and nothing else.
 */
describe('safeReturnUrl', () => {
  it.each([
    '/en/s/9f2k4tqvb1xz8mq7',
    '/velista/es/shopping-lists/b1',
    '/en/home?tab=lists',
  ])('keeps the in app path %s', (path) => {
    expect(safeReturnUrl(path)).toBe(path);
  });

  it.each([
    ['nothing', null],
    ['absent', undefined],
    ['empty', ''],
    ['a full URL', 'https://evil.example/en/home'],
    ['a scheme', 'javascript:alert(1)'],
    ['a relative path with no slash', 'en/home'],
    ['another host', '//evil.example/en/home'],
    ['another host behind a backslash', '/\\evil.example'],
    ['another host once decoded', '/%2F%2Fevil.example'],
    ['a backslash later on', '/en/..\\..\\evil'],
    ['a control character', '/en/\nhome'],
  ])('refuses %s', (_, value) => {
    expect(safeReturnUrl(value)).toBeNull();
  });
});
