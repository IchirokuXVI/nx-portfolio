import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copy the owner approved, read from the shipped files: the Spanish sentence said
 * when a line hides at 0 carries no gender, whatever the name is (velista `0192`,
 * 2026-11-17), and the words of the view picker (velista `0202`, 2026-11-22).
 */
describe('copy the owner ruled on', () => {
  const copy = (locale: 'en' | 'es') =>
    JSON.parse(
      readFileSync(join(__dirname, `../../assets/i18n/${locale}.json`), 'utf8')
    ) as {
      account: Record<string, unknown>;
      list: { line: { hiddenAtZero: string } };
      view: Record<string, string>;
    };

  it('names the view picker and its two views as the mock draws them', () => {
    expect(copy('en').view).toEqual({
      title: 'View',
      default: 'Default',
      compact: 'Compact',
      compactHint: 'More rows on the screen',
    });
    expect(copy('es').view).toEqual({
      title: 'Vista',
      default: 'Normal',
      compact: 'Compacta',
      compactHint: 'Más filas en la pantalla',
    });
  });

  it('keeps no words for the rows switch the account page had', () => {
    expect(copy('en').account['listRows']).toBeUndefined();
    expect(copy('es').account['listRows']).toBeUndefined();
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
