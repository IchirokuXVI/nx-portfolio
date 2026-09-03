import { toDeployment } from './deployment';

/**
 * Rule D4: the app owns its own enum and maps into it from `unknown`, rather than
 * passing a backend string through as if it were already the type.
 *
 * The case worth the test is the one that is not a typo: a gateway that grows a
 * fourth environment name, or answers something malformed, must not be read as one
 * of the three this app draws a colour for.
 */
describe('toDeployment', () => {
  it.each(['production', 'staging', 'development'])('adopts %s', (name) => {
    expect(toDeployment(name)).toBe(name);
  });

  it.each([
    ['a name this app does not know', 'preview'],
    ['a near miss', 'prod'],
    ['the wrong case, which is a different string', 'Production'],
    ['nothing at all', undefined],
    ['an explicit null', null],
    ['a number', 3],
    ['an object', { environment: 'production' }],
  ])('refuses %s rather than guessing', (_why, value) => {
    expect(toDeployment(value)).toBeNull();
  });
});
