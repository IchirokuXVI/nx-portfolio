import { LEGAL_TEMPLATES } from '@portfolio/luna-shopper/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The texts and the backend name the same version (velista `0172`, section 5.4).
 *
 * The gateway serves `LEGAL_TEMPLATES` as the terms version a person accepts and as
 * the policy's date, and this library ships the texts that version names. A change of
 * meaning bumps both in one pull request; this spec fails the one that bumps only one.
 *
 * Importing a contracts constant here is not rule D4's concern: no wire type reaches
 * app code, and only a spec reads it.
 */
function templateVersion(file: string): unknown {
  const raw = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'assets', 'legal', file), 'utf8')
  ) as { templateVersion?: unknown };
  return raw.templateVersion;
}

describe('the template version (section 5.4)', () => {
  it.each(['terms.en.json', 'terms.es.json'])(
    '%s names LEGAL_TEMPLATES.terms.version',
    (file) => {
      expect(templateVersion(file)).toBe(LEGAL_TEMPLATES.terms.version);
    }
  );

  it.each(['privacy.en.json', 'privacy.es.json'])(
    '%s names LEGAL_TEMPLATES.privacy.updatedOn',
    (file) => {
      expect(templateVersion(file)).toBe(LEGAL_TEMPLATES.privacy.updatedOn);
    }
  );
});
