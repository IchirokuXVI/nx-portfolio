import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEZA_CEILING_PAGES, DEZA_PAGE_SIZE, parseProductPage } from './rows';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const landing = parseProductPage(fixture('landing-page.html'));
const search = parseProductPage(fixture('search-one-page.html'));
const pastEnd = parseProductPage(fixture('page-past-the-end.html'));

describe('parseProductPage', () => {
  it('reads the 15 rows a listing page holds', () => {
    expect(landing.rows).toHaveLength(DEZA_PAGE_SIZE);
    expect(landing.rows[0].description).toBe('Vino blanco DON SIMON brik 1 L');
  });

  it('splits the description into a name and a verbatim size', () => {
    expect(landing.rows[0]).toMatchObject({
      name: 'Vino blanco DON SIMON brik',
      sizeFormat: '1 L',
      brand: 'DON SIMON',
    });
  });

  it('names every shop a popup lists, by code and by printed name', () => {
    expect(landing.rows[0].shops).toEqual([
      { code: 'T1', printedName: 'Jesús Rescatado' },
      { code: 'T2', printedName: 'Ctra. de Castro' },
      { code: 'T3', printedName: 'Ronda del Marrubial' },
      { code: 'T4', printedName: 'Isla Fuerteventura' },
      { code: 'T5', printedName: 'Camino de la Barca' },
      { code: 'C1', printedName: 'SuperCash (Quemadas)' },
      { code: 'Z1', printedName: 'Zoco' },
      { code: 'T6', printedName: 'Avda. de Libia' },
      { code: 'C2', printedName: 'SuperCash (Sector Sur)' },
      { code: 'T7', printedName: 'Fuente de la salud' },
    ]);
  });

  it('parses a product carried by fewer shops as fewer, which is the claim', () => {
    // Availability by omission is the whole value of this source: a product
    // stocked everywhere lists ten shops and a niche one lists a single shop,
    // and the eight it does not list are the negative plan 0084 receives.
    const counts = landing.rows.map((row) => row.shops.length);
    expect(Math.max(...counts)).toBe(10);
    expect(Math.min(...counts)).toBe(1);
    expect(counts.some((count) => count > 1 && count < 10)).toBe(true);
  });

  it('produces no price field at all, blank or otherwise', () => {
    // Every shop in every popup carries a `wpdz-precio-ok` and a
    // `wpdz-precio-oculto` element, and both are blank on the public site. A
    // parser that treated a blank string as a price would write zeros.
    expect(fixture('landing-page.html')).toContain('wpdz-precio-ok');
    for (const row of landing.rows) {
      expect(Object.keys(row).some((key) => /price|precio/i.test(key))).toBe(
        false
      );
      for (const shop of row.shops) {
        expect(Object.keys(shop)).toEqual(['code', 'printedName']);
      }
    }
  });

  it('captures the chain’s attribute icons', () => {
    const andaluz = landing.rows.filter((row) =>
      row.attributes.includes('Andaluz')
    );
    expect(andaluz.length).toBeGreaterThan(0);
    expect(
      landing.rows.some(
        (row) =>
          row.attributes.includes('Vegano/Vegetar.') &&
          row.attributes.includes('Ecológicos')
      )
    ).toBe(true);
    expect(landing.rows[0].attributes).toEqual([]);
  });

  it('reads the last page number from the pagination widget', () => {
    expect(landing.lastPage).toBe(DEZA_CEILING_PAGES);
  });

  it('answers 0 for a query that renders no widget, not 1', () => {
    expect(search.rows).toHaveLength(8);
    expect(search.lastPage).toBe(0);
  });

  it('parses a page past the end as zero rows rather than an error', () => {
    expect(pastEnd.rows).toEqual([]);
    // The widget is still rendered, so the ceiling is still visible from here.
    expect(pastEnd.lastPage).toBe(DEZA_CEILING_PAGES);
  });
});
