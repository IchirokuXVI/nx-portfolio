import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The owner's ruling of 2026-11-17 (admin plan 0070, decision G): only a loose
 * product sold by the kilo carries a step. No product by the litre does, so the
 * refusal never advises selling one by the litre.
 */
describe('the step refusal (admin plan 0070)', () => {
  it('names the loose kilo product alone', () => {
    const copy = JSON.parse(
      readFileSync(join(__dirname, '../../assets/i18n/en.json'), 'utf8')
    ) as { resource: { error: { itemQuantityStepNotAllowed: string } } };

    const sentence = copy.resource.error.itemQuantityStepNotAllowed;
    expect(sentence).toBe(
      'Only a loose product sold by the kilo has a step. Choose the default, or sell it loose by the kilo.'
    );
    expect(sentence).not.toMatch(/litre|liter/i);
  });
});
