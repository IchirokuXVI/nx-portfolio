import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copy the owner approved on 2026-11-17, read from the shipped files: the compact
 * rows hint names the device, not the phone (velista `0191`), and the Spanish
 * sentence said when a line hides at 0 carries no gender, whatever the name is
 * (velista `0192`).
 */
describe('copy the owner ruled on (2026-11-17)', () => {
  const copy = (locale: 'en' | 'es') =>
    JSON.parse(
      readFileSync(join(__dirname, `../../assets/i18n/${locale}.json`), 'utf8')
    ) as {
      account: { listRows: { hint: string } };
      list: { line: { hiddenAtZero: string } };
    };

  it('says the compact rows are kept on this device', () => {
    expect(copy('en').account.listRows.hint).toBe(
      'Lists show the size, the price and the total on every row. Only on this device.'
    );
    expect(copy('es').account.listRows.hint).toBe(
      'Las listas muestran el tamaño, el precio y el total en cada fila. Solo en este dispositivo.'
    );
  });

  it('says a line at 0 is hidden with no word that agrees with the name', () => {
    const es = copy('es').list.line.hiddenAtZero;
    expect(es).toBe(
      '{{name}} está a 0 y se oculta. Busca la línea para recuperarla.'
    );
    expect(copy('en').list.line.hiddenAtZero).toBe(
      '{{name}} is at 0 and hidden. Search for it to bring it back.'
    );
  });
});
