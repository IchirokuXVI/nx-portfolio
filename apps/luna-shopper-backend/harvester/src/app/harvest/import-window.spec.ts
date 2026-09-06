import { localMidnightUtc, resolveImportWindow } from './import-window';

/**
 * A document's dates are local days in Spain (plan 0081, section 5, carried into
 * plan 0086 section 5).
 *
 * The cases that matter are the two hours a year the clocks move: Spain is
 * UTC+2 in summer and UTC+1 in winter, so a window spanning the last Sunday of
 * October has a start and an end on different offsets, and a fixed `+02:00`
 * would end it an hour early.
 *
 * What plan 0086 changed is the answer when nobody states a window at all: none,
 * rather than a refusal. A walk's export has no window, because a storefront
 * price has none. **Half** a window is still refused, for the reason the whole
 * rule exists.
 */
describe('import validity (plan 0086, section 5)', () => {
  describe('local midnight', () => {
    it('is 22:00 UTC the day before, in summer time', () => {
      expect(localMidnightUtc('2026-08-27').toISOString()).toBe(
        '2026-08-26T22:00:00.000Z'
      );
    });

    it('is 23:00 UTC the day before, in winter time', () => {
      expect(localMidnightUtc('2026-11-03').toISOString()).toBe(
        '2026-11-02T23:00:00.000Z'
      );
    });

    it('follows the clock across the last Sunday of October', () => {
      // The change is on 2026-10-25. The day before is still +02:00 and the day
      // after is +01:00, so the two midnights are 25 hours apart rather than 24.
      const before = localMidnightUtc('2026-10-25').getTime();
      const after = localMidnightUtc('2026-10-26').getTime();
      expect(after - before).toBe(25 * 60 * 60 * 1000);
    });

    it('refuses anything that is not a YYYY-MM-DD day', () => {
      expect(() => localMidnightUtc('27/08/2026')).toThrow(/YYYY-MM-DD/);
    });
  });

  describe('the window a run writes with', () => {
    it('starts at local midnight and ends at local midnight the day after', () => {
      // Exclusive: a window stated "to 23 September" covers the whole of the
      // 23rd, so the boundary is the start of the 24th.
      const window = resolveImportWindow({
        documentFrom: '2026-08-27',
        documentUntil: '2026-09-23',
      });

      expect(window?.validFrom.toISOString()).toBe('2026-08-26T22:00:00.000Z');
      expect(window?.validUntil.toISOString()).toBe('2026-09-23T22:00:00.000Z');
    });

    it('takes the admin override over the document, on either bound', () => {
      const window = resolveImportWindow({
        documentFrom: '2026-08-27',
        documentUntil: '2026-09-23',
        overrideFrom: '2026-09-01',
        overrideUntil: '2026-09-07',
      });

      expect(window?.validFrom.toISOString()).toBe('2026-08-31T22:00:00.000Z');
      expect(window?.validUntil.toISOString()).toBe('2026-09-07T22:00:00.000Z');
    });

    it('answers none when nobody states a window', () => {
      // A storefront price has no window, and a walk's own export is exactly
      // that document (plan 0086, section 5).
      expect(
        resolveImportWindow({ documentFrom: null, documentUntil: null })
      ).toBeNull();
    });

    it('refuses an end with no start, which would apply now', () => {
      expect(() =>
        resolveImportWindow({
          documentFrom: null,
          documentUntil: '2026-09-23',
        })
      ).toThrow(/no start date/);
    });

    it('refuses a start with no end, which would never expire', () => {
      expect(() =>
        resolveImportWindow({
          documentFrom: '2026-08-27',
          documentUntil: null,
        })
      ).toThrow(/no end date/);
    });

    it('accepts an override that supplies both bounds a document lacks', () => {
      const window = resolveImportWindow({
        documentFrom: null,
        documentUntil: null,
        overrideFrom: '2026-09-01',
        overrideUntil: '2026-09-01',
      });

      // One day long, which is a legal window: valid from the start of the 1st
      // to the start of the 2nd.
      expect(
        (window as { validUntil: Date; validFrom: Date }).validUntil.getTime() -
          (window as { validFrom: Date }).validFrom.getTime()
      ).toBe(24 * 60 * 60 * 1000);
    });

    it('refuses a window that ends before it starts', () => {
      expect(() =>
        resolveImportWindow({
          documentFrom: '2026-09-23',
          documentUntil: '2026-08-27',
        })
      ).toThrow(/before it starts/);
    });

    it('leaves a future start in the future, which is the Lidl case', () => {
      // Lidl publishes three days before the prices apply. Plan 0080's
      // resolution excludes such a row until its `validFrom`, and the sweep
      // flips it on the day with no further write.
      const window = resolveImportWindow({
        documentFrom: '2099-01-04',
        documentUntil: '2099-01-10',
      });

      expect(window?.validFrom.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
