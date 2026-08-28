import {
  ANONYMIZED_USERNAME_PREFIX,
  anonymizedUsername,
} from './anonymize';

describe('anonymizedUsername', () => {
  it('uses the neutral prefix plus an 8-char id slice', () => {
    const name = anonymizedUsername('0123456789abcdef');
    expect(name).toBe(`${ANONYMIZED_USERNAME_PREFIX} 01234567`);
  });

  it('produces distinct names for distinct memberships (unique per zone)', () => {
    expect(anonymizedUsername('aaaaaaaa-1111')).not.toBe(
      anonymizedUsername('bbbbbbbb-2222')
    );
  });
});
