/**
 * The fourteen renames of plan 0221, section 1, as the DEZA walk `e8c1c92b` of
 * 2026-10-16 left them: `before` is the old `ACTIVE` row the walk did not see,
 * `after` the new `UNRESOLVED` row it created.
 *
 * Read off the slot 1 backup of that date through `wordOrderKey` and
 * `matchAnyOrder` themselves, not typed from the plan's table, so the specs
 * pin the pairs the code finds. The size text and the unit size are the
 * stored ones. Where the walk kept the size inside the name, both are null.
 */
export const DEZA_RENAMES_2026_10_16: readonly {
  before: string;
  after: string;
  sizeFormat: string | null;
  unitSize: number | null;
}[] = [
  {
    before: 'Chorizo ibérico de bellota ESENCIA ÚNICA Covap',
    after: 'Chorizo de bellota ibérico ESENCIA ÚNICA Covap',
    sizeFormat: '60 g',
    unitSize: 60,
  },
  {
    before: 'Queso mezcla SAN VICENTE semicurado kg',
    after: 'Queso mezcla semicurado SAN VICENTE kg',
    sizeFormat: null,
    unitSize: null,
  },
  {
    before: 'Chorizo ibérico de bellota ESENCIA ÚNICA Covap 170 g aprox/',
    after: 'Chorizo de bellota ibérico ESENCIA ÚNICA Covap 170 g aprox/',
    sizeFormat: null,
    unitSize: null,
  },
  {
    before: 'Chorizo ibérico de bellota ESENCIA ÚNICA Covap pieza 600 g aprox/',
    after: 'Chorizo de bellota ibérico ESENCIA ÚNICA Covap pieza 600 g aprox',
    sizeFormat: null,
    unitSize: null,
  },
  {
    before: 'Morcón ibérico de bellota ESENCIA ÚNICA Covap 450 g aprox/',
    after: 'Morcón de bellota ibérico ESENCIA ÚNICA Covap 450 g aprox/',
    sizeFormat: null,
    unitSize: null,
  },
  {
    before: 'Salchichón ibérico bellota ESENCIA ÚNICA Covap 170 g aprox/',
    after: 'Salchichón bellota ibérico ESENCIA ÚNICA Covap 170 g aprox/',
    sizeFormat: null,
    unitSize: null,
  },
  {
    before: 'Salchichón ibérico bellota ESENCIA ÚNICA Covap pieza 600 g aprox/',
    after: 'Salchichón bellota ibérico ESENCIA ÚNICA Covap pieza 600 g aprox/',
    sizeFormat: null,
    unitSize: null,
  },
  {
    before: 'Salchichón ibérico bellota ESENCIA ÚNICA Covap',
    after: 'Salchichón bellota ibérico ESENCIA ÚNICA Covap',
    sizeFormat: '60 g',
    unitSize: 60,
  },
  {
    before: 'Jamón de cebo de campo COVAP 100% ibérico Esencia Única',
    after: 'Jamón de cebo de campo ESENCIA ÚNICA Covap 100% ibérico',
    sizeFormat: '60 g',
    unitSize: 60,
  },
  {
    before: 'Torreznos de Soria MORENO SAEZ dados',
    after: 'Torreznos de Soria en dados MORENO SAEZ',
    sizeFormat: '200 g',
    unitSize: 200,
  },
  {
    before: 'Pechuga pavo lonchas finas ELPOZO bienstar reducido de sal',
    after: 'Pechuga pavo lonchas finas ELPOZO bienstar reducido en sal',
    sizeFormat: '65 g',
    unitSize: 65,
  },
  {
    before: 'Jamón cocido lonchas finas ELPOZO bienstar reducido de sal',
    after: 'Jamón cocido lonchas finas ELPOZO bienstar reducido en sal',
    sizeFormat: '65 g',
    unitSize: 65,
  },
  {
    before: 'Queso fundido lonchas EL CASERIO 8 ud',
    after: 'Queso fundido en lonchas EL CASERIO 8 ud',
    sizeFormat: '150 g',
    unitSize: 150,
  },
  {
    before: 'Queso bola Edam ROYAL CROWN tierno cuña',
    after: 'Queso bola Edam tierno ROYAL CROWN cuña',
    sizeFormat: '310 g',
    unitSize: 310,
  },
];
