import { toAdminEnvironment, UNKNOWN_ENVIRONMENT } from './admin-environment';

/**
 * The unauthenticated environment read (plan 0001, section 6; plan 0002,
 * section 5).
 *
 * One of these two fields decides a colour and the other decides whether the app
 * asks for a password at all, so the assertions below are mostly about the
 * second: every way of not being told must come out as `false`.
 */
describe('toAdminEnvironment', () => {
  it('reads a deployment that names itself and offers no autologin', () => {
    expect(toAdminEnvironment({ environment: 'production' })).toEqual({
      deployment: 'production',
      devAutologin: false,
    });
  });

  it('reads a development gateway that will sign the operator in', () => {
    expect(
      toAdminEnvironment({ environment: 'development', devAutologin: true })
    ).toEqual({ deployment: 'development', devAutologin: true });
  });

  it('answers unknown for an environment name it does not recognise', () => {
    expect(toAdminEnvironment({ environment: 'preview-7' })).toEqual(
      UNKNOWN_ENVIRONMENT
    );
  });

  /**
   * The one that matters. Skipping authentication may only ever happen because
   * the server said so in as many words, so every shape that is not literally
   * `true` has to answer `false` — including the truthy ones, which is why the
   * mapper compares rather than tests.
   */
  it.each([
    ['a missing field', {}],
    ['a string', { devAutologin: 'true' }],
    ['a truthy number', { devAutologin: 1 }],
    ['an object', { devAutologin: {} }],
    ['an explicit false', { devAutologin: false }],
    ['no body at all', null],
    ['a string body', 'development'],
  ])('refuses to autologin on %s', (_case, body) => {
    expect(toAdminEnvironment(body).devAutologin).toBe(false);
  });
});
