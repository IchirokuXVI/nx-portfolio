import { REDACTION_CENSOR, REDACTION_PATHS } from '../logging/redaction';
import {
  isSensitiveAttributeKey,
  redactSpanAttributes,
  SENSITIVE_ATTRIBUTE_KEYS,
} from './span-attributes';

describe('span attributes', () => {
  it('protects every key the pino redaction list protects', () => {
    // The point of deriving the set: adding a path to `logging/redaction.ts`
    // keeps it out of spans too, with no second list to remember.
    const expected = [
      'password',
      'currentPassword',
      'newPassword',
      'token',
      'accessToken',
      'refreshToken',
      'clientSecret',
      'authorization',
      'cookie',
      'set-cookie',
    ];

    for (const key of expected) {
      expect(isSensitiveAttributeKey(key)).toBe(true);
    }
    expect(SENSITIVE_ATTRIBUTE_KEYS.size).toBe(expected.length);
  });

  it('derives the set from the redaction list rather than restating it', () => {
    // A guard against the two drifting apart: every path in the source list must
    // land on a protected key (the bare wildcards excepted).
    for (const path of REDACTION_PATHS) {
      const key = path.split('.').pop() ?? '';
      if (key === '*' || key.includes('[')) {
        continue;
      }
      expect(isSensitiveAttributeKey(key)).toBe(true);
    }
  });

  it('catches an instrumentation style header attribute', () => {
    expect(isSensitiveAttributeKey('http.request.header.authorization')).toBe(
      true
    );
    expect(isSensitiveAttributeKey('http.request.header.accept')).toBe(false);
  });

  it('censors secrets and keeps everything else', () => {
    expect(
      redactSpanAttributes({
        'luna.zone_id': 'z-1',
        password: 'hunter2',
        accessToken: 'ey...',
        attempts: 3,
        retried: false,
      })
    ).toEqual({
      'luna.zone_id': 'z-1',
      password: REDACTION_CENSOR,
      accessToken: REDACTION_CENSOR,
      attempts: 3,
      retried: false,
    });
  });

  it('drops absent values instead of recording the string "undefined"', () => {
    expect(
      redactSpanAttributes({ present: 'yes', missing: undefined, empty: null })
    ).toEqual({ present: 'yes' });
  });

  it('coerces values a span cannot carry natively', () => {
    expect(
      redactSpanAttributes({ big: 10n, list: [1, 'two'], object: { a: 1 } })
    ).toEqual({ big: '10', list: ['1', 'two'], object: '[object Object]' });
  });
});
