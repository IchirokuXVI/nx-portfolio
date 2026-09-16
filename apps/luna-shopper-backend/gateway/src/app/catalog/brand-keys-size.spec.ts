import {
  BRAND_LABEL_MAX_LENGTH,
  type ListBrandSuggestionsRequest,
} from '@portfolio/luna-shopper/contracts';

/**
 * The whole registry travels in one NATS message, and that has a ceiling (plan
 * 0115, section 7.3).
 *
 * `GET /v1/admin/catalog/brand-suggestions` reads every registered key from
 * catalog and sends the lot to the harvester, because the harvester holds no
 * copy of the registry and a copy is a second answer to "what is registered".
 * The default NATS payload limit is 1 MB, so this spec is what makes the
 * headroom a fact rather than an assumption: 5,000 keys of 30 characters, the
 * shape section 7.3 names, under half the limit.
 *
 * When this fails, the answer is **not** a bigger message. It is a copy of the
 * keys kept in the harvester and fed by an event, which is the alternative the
 * comment on `BRAND_PATTERNS.keys` names.
 */
describe('the registered keys a suggestions request carries', () => {
  /** Half the default NATS payload limit, in bytes. */
  const HEADROOM_BYTES = 512 * 1024;

  const requestOf = (keys: string[]): ListBrandSuggestionsRequest => ({
    userId: '11111111-1111-4111-8111-111111111111',
    adminToken: 'a'.repeat(900),
    registeredKeys: keys,
    query: 'hacendado',
    limit: 100,
  });

  it('serializes 5,000 keys of 30 characters under 512 KB', () => {
    const keys = Array.from({ length: 5000 }, (_, index) =>
      `brand${index}`.padEnd(30, 'x')
    );
    expect(keys[0]).toHaveLength(30);

    const bytes = Buffer.byteLength(JSON.stringify(requestOf(keys)), 'utf8');

    expect(bytes).toBeLessThan(HEADROOM_BYTES);
  });

  it('still fits when every key is as long as a label may be', () => {
    // The worst case the column allows: 5,000 keys at the 120 character bound.
    // It is far past any plausible registry, and it still clears 1 MB, which is
    // what says the headroom is not resting on keys being short in practice.
    const keys = Array.from({ length: 5000 }, (_, index) =>
      `brand${index}`.padEnd(BRAND_LABEL_MAX_LENGTH, 'x')
    );

    const bytes = Buffer.byteLength(JSON.stringify(requestOf(keys)), 'utf8');

    expect(bytes).toBeLessThan(1024 * 1024);
  });
});
