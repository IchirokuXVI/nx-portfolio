import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Every run warning code has a label** (admin plan 0071).
 *
 * The run page draws a warning as `'harvest.warning.' + code | rokuT`, a key
 * built from a value, which `translations.spec.ts` can count and cannot check.
 * i18next answers a missing key with the key, so a code the harvester added
 * reads as `harvest.warning.LISTING_UNREAD` on the screen and nowhere else.
 *
 * The codes are read from the committed OpenAPI document rather than from the
 * contracts library, so no admin code imports anything new to make this spec
 * possible. The gateway's own spec keeps that document current.
 */

const WORKSPACE = join(__dirname, '..', '..', '..', '..', '..');

const OPENAPI = JSON.parse(
  readFileSync(
    join(
      WORKSPACE,
      'apps',
      'luna-shopper-backend',
      'gateway',
      'docs',
      'openapi.json'
    ),
    'utf8'
  )
) as {
  components: { schemas: Record<string, { enum?: readonly string[] }> };
};

const CATALOGUE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'assets', 'i18n', 'en.json'), 'utf8')
) as { harvest: { warning: Record<string, unknown> } };

const CODES =
  OPENAPI.components.schemas['enums.HarvestWarningCode']?.enum ?? [];

/** The codes with no non empty label under `harvest.warning`. */
function unlabelled(codes: readonly string[]): string[] {
  const labels = CATALOGUE.harvest.warning;
  return codes.filter((code) => {
    const label = labels[code];
    return typeof label !== 'string' || label.trim() === '';
  });
}

describe('harvest.warning labels', () => {
  it('reads the codes from the document', () => {
    // An empty list would pass the next case with nothing checked.
    expect(CODES.length).toBeGreaterThan(0);
  });

  it('gives every HarvestWarningCode a label', () => {
    expect(unlabelled(CODES)).toEqual([]);
  });

  it('fails for a code with no label', () => {
    expect(unlabelled([...CODES, 'A_CODE_NOBODY_WROTE'])).toEqual([
      'A_CODE_NOBODY_WROTE',
    ]);
  });
});
