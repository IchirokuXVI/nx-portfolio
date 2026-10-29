import {
  effectiveTermsVersion,
  LEGAL_TEMPLATES,
  privacyUpdatedOn,
  termsUpdatedOn,
} from './legal-documents';

describe('legal document versions (plan 0231, section 1)', () => {
  const template = LEGAL_TEMPLATES.terms.version;

  it('is the template version alone when the operator set no revision', () => {
    expect(effectiveTermsVersion('')).toBe(template);
    expect(effectiveTermsVersion('  ')).toBe(template);
    expect(effectiveTermsVersion(undefined)).toBe(template);
    expect(termsUpdatedOn('')).toBe(template);
    expect(privacyUpdatedOn('')).toBe(LEGAL_TEMPLATES.privacy.updatedOn);
  });

  it('carries both dates when the operator amended their terms', () => {
    expect(effectiveTermsVersion('2099-12-15')).toBe(`${template}+2099-12-15`);
    expect(termsUpdatedOn('2099-12-15')).toBe('2099-12-15');
    expect(privacyUpdatedOn('2099-12-15')).toBe('2099-12-15');
  });

  it('keeps the template date for updatedOn when the revision is earlier, and both in the version', () => {
    expect(effectiveTermsVersion('2000-01-01')).toBe(`${template}+2000-01-01`);
    expect(termsUpdatedOn('2000-01-01')).toBe(template);
    expect(privacyUpdatedOn('2000-01-01')).toBe(
      LEGAL_TEMPLATES.privacy.updatedOn
    );
  });
});
