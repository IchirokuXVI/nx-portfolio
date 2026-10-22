import { plainText } from './plain-text';

/**
 * The backstop for the plain text rule (plan 0225, section 2): the four shapes
 * the evaluation saw are removed and counted, and nothing else is touched.
 */
describe('plainText', () => {
  it('unwraps bold written with asterisks or underscores', () => {
    expect(plainText('Tienes **leche** y __pan__ en el Piso.')).toEqual({
      text: 'Tienes leche y pan en el Piso.',
      stripped: 2,
    });
  });

  it('turns consecutive bullet lines into one sentence', () => {
    expect(
      plainText('En el Piso tienes:\n- leche\n- pan\n- huevos\nNada más.')
    ).toEqual({
      text: 'En el Piso tienes:\nleche, pan, huevos.\nNada más.',
      stripped: 3,
    });
  });

  it('reads `* `, `• ` and numbered markers as bullets too', () => {
    expect(plainText('* leche\n• pan\n1. huevos')).toEqual({
      text: 'leche, pan, huevos.',
      stripped: 3,
    });
  });

  it('keeps the end punctuation of the last item and drops it between items', () => {
    expect(plainText('- leche.\n- pan!')).toEqual({
      text: 'leche, pan!',
      stripped: 2,
    });
  });

  it('gives each run of bullets its own sentence', () => {
    expect(plainText('Piso:\n- leche\n- pan\n\nCasa:\n- arroz')).toEqual({
      text: 'Piso:\nleche, pan.\n\nCasa:\narroz.',
      stripped: 3,
    });
  });

  it('drops heading markers', () => {
    expect(plainText('## Tus listas\nTienes dos.')).toEqual({
      text: 'Tus listas\nTienes dos.',
      stripped: 1,
    });
  });

  it('keeps the text of a markdown link and drops the address', () => {
    expect(
      plainText('Está en [el Piso](https://velista.app/lists/list-flat).')
    ).toEqual({ text: 'Está en el Piso.', stripped: 1 });
  });

  it('counts every replacement in one reply', () => {
    expect(
      plainText('# Listas\n- **leche** en [Piso](https://x.test)\n- pan')
        .stripped
    ).toBe(5);
  });

  it('leaves plain text alone, a lone asterisk and an underscore in a word included', () => {
    const text =
      'Son 2 * 3 cosas en lista_compra, y __init y nada más.\r\nVale.';
    expect(plainText(text)).toEqual({ text, stripped: 0 });
  });
});
