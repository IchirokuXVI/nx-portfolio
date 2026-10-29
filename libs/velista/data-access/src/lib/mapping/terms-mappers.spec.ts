import { toAccountTerms, toTermsAcceptance, toUserProfile } from './mappers';

const ME = { userId: 'u1', kind: 'REGISTERED', username: 'Marta' };

describe('toUserProfile: the terms (velista 0173)', () => {
  it('reads the block of GET /v1/account/me', () => {
    expect(
      toUserProfile({
        ...ME,
        terms: {
          currentVersion: '2026-10-29',
          acceptedVersion: null,
          acceptanceRequired: true,
        },
      })?.terms
    ).toEqual({
      currentVersion: '2026-10-29',
      acceptedVersion: null,
      acceptanceRequired: true,
    });
  });

  it('leaves it off a body that carries none: an older backend asks nothing', () => {
    expect(toUserProfile(ME)).not.toHaveProperty('terms');
  });
});

describe('toAccountTerms', () => {
  it('reads anything but a JSON true as nothing required', () => {
    expect(
      toAccountTerms({
        currentVersion: '2026-10-29',
        acceptanceRequired: 'yes',
      })
    ).toEqual({
      currentVersion: '2026-10-29',
      acceptedVersion: null,
      acceptanceRequired: false,
    });
    expect(toAccountTerms(null)).toEqual({
      currentVersion: '',
      acceptedVersion: null,
      acceptanceRequired: false,
    });
  });
});

describe('toTermsAcceptance', () => {
  it('maps the 201 of POST /v1/account/terms-acceptances', () => {
    expect(
      toTermsAcceptance({
        version: '2026-10-29',
        acceptedAt: '2026-10-29T10:00:00.000Z',
      })
    ).toEqual({
      version: '2026-10-29',
      acceptedAt: '2026-10-29T10:00:00.000Z',
    });
  });

  it('is null for an answer with no version', () => {
    expect(toTermsAcceptance({ acceptedAt: 'x' })).toBeNull();
    expect(toTermsAcceptance('nope')).toBeNull();
  });
});
