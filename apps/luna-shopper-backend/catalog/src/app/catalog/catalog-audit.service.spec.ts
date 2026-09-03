import { diffFields } from './catalog-audit.service';

/**
 * The rule that decides how big the trail gets (plan 0075, section 4).
 *
 * Everything transactional about the audit is proven against real Postgres in
 * `catalog-audit.integration.spec.ts`, because a double cannot roll back. What
 * is left here is pure and is the part that is easy to get subtly wrong: which
 * fields count as a change, and which comparisons are two spellings of the same
 * value rather than a change.
 */
describe('diffFields (plan 0075, section 4)', () => {
  it('reports only the fields that moved', () => {
    const moved = diffFields(
      { price: 1.75, currency: 'EUR', available: true },
      { price: 1.8, currency: 'EUR', available: true }
    );

    // Not the whole row. A snapshot of thirty fields on every write buries the
    // one that changed, which is the question the trail exists to answer.
    expect(moved).toEqual({
      before: { price: 1.75 },
      after: { price: 1.8 },
    });
  });

  it('reports nothing when no field moved', () => {
    expect(
      diffFields(
        { price: 1.75, available: true },
        { price: 1.75, available: true }
      )
    ).toBeNull();
  });

  it('treats a numeric read back as a string as the same number', () => {
    // Postgres hands a `numeric` column back as a string and a service assigns a
    // number, so this is one price written twice rather than a change. Without
    // it every re-fetch of an unmoved price would write an audit row.
    expect(diffFields({ price: '1.75' }, { price: 1.75 })).toBeNull();
    expect(diffFields({ unitPrice: 0.63 }, { unitPrice: '0.6300' })).toBeNull();
  });

  it('does not collapse two strings that merely look numeric', () => {
    // The comparison above is only applied across a number and a string. An
    // `externalKey` is a varchar, and `4661` and `4661.0` are two different
    // warehouse keys.
    expect(
      diffFields({ externalKey: '4661' }, { externalKey: '4661.0' })
    ).toEqual({
      before: { externalKey: '4661' },
      after: { externalKey: '4661.0' },
    });
  });

  it('compares a localized name by value rather than by identity', () => {
    expect(
      diffFields(
        { name: { en: 'Milk', es: 'Leche' } },
        { name: { en: 'Milk', es: 'Leche' } }
      )
    ).toBeNull();
    expect(
      diffFields(
        { name: { en: 'Milk', es: 'Leche' } },
        { name: { en: 'Milk', es: 'Lechey' } }
      )
    ).not.toBeNull();
  });

  it('records a field that became null, and one that arrived', () => {
    const moved = diffFields({ label: 'Centro' }, { label: null });
    expect(moved).toEqual({
      before: { label: 'Centro' },
      after: { label: null },
    });

    // `undefined` is not json, so a field the object did not carry reads as null
    // rather than vanishing from the comparison.
    expect(diffFields({}, { label: 'Centro' })).toEqual({
      before: { label: null },
      after: { label: 'Centro' },
    });
  });

  it('writes a date as an ISO string rather than a Date', () => {
    const moved = diffFields(
      { at: new Date('2026-08-01T00:00:00.000Z') },
      { at: new Date('2026-09-01T00:00:00.000Z') }
    );

    expect(moved?.after).toEqual({ at: '2026-09-01T00:00:00.000Z' });
  });
});
