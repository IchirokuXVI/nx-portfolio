// The two data stages of 2026-10-07 that came after plan 0192. Neither is a plan.
//
// - `stage-c6/` is the re-file: 2,250 products moved onto the leaves that plan 0179 added.
// - `stage-c7/` is the second curation walk: 2,586 queue rows that the first walk could not
//   place, decided by blind deciders and applied.
//
// Both folders stand in the run folder. The files of this script are `d01` to `d06`.
//
// Three records are too large for this folder, so the files hold their rules and their
// counts, and the header of each file names the full record:
//
// - the 2,250 moves of the re-file (`stage-c6/proposal/<leaf>.json`)
// - the 2,430 products that the walk created (`stage-c7/applied/created.jsonl`)
// - the 579 printed texts that are not a brand (`stage-c7/brands/skipped.jsonl`)
import fs from 'node:fs';
import path from 'node:path';
import {
  J,
  JL,
  SRC,
  itemState,
  product,
  row,
  rowState,
  startGaps,
  writeData,
} from './lib.mjs';

const REFILE = 'applied on 2026-10-07 (stage c6)';
const WALK = 'applied on 2026-10-07 (stage c7)';
const count = (list, key) => {
  const out = {};
  for (const x of list) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
};
const sorted = (o) =>
  Object.fromEntries(
    Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  );

// ---------------------------------------------------------------------------------------
// The rules of the re-file. They are the rules of `stage-c6/propose.mjs`, written here as
// data. The build counts the products of `stage-c6/proposal/` that each rule explains, so a
// rule that was copied wrong shows as a product that no rule explains.
// ---------------------------------------------------------------------------------------

/** Make-up out of `facial-care`, in the order that the stage tried the rules. */
const MERCADONA_SHELF = [
  [/^Mercadona: Maquillaje > Bases de maquillaje y corrector/, 'face-makeup'],
  [/^Mercadona: Maquillaje > Colorete y polvos/, 'powders-and-blush'],
  [/^Mercadona: Maquillaje > Ojos/, 'eye-makeup'],
  [/^Mercadona: Maquillaje > Labios > Cuidado/, null],
  [/^Mercadona: Maquillaje > Labios/, 'lip-makeup'],
  [/^Mercadona: Maquillaje > Pinceles y brochas/, 'makeup-tools'],
  [/^Mercadona: Cuidado facial y corporal > Manicura y pedicura/, 'nail-care'],
];
const MERCADONA_BY_NAME = [
  [/^Bronceador facial fluido/, 'powders-and-blush'],
  [/^Iluminador facial fluido/, 'powders-and-blush'],
  [/^Rizador de pestañas/, 'makeup-tools'],
];
const NAME_MAKEUP = [
  [/^(Laca de uñas|Base de uñas|Top coat|Quitaesmalte)/, 'nail-care'],
  [
    /^(Brocha|Pincel|Sacapuntas|Rizador de pestañas|Esponja de maquillaje|Limpiador de brochas)/,
    'makeup-tools',
  ],
  [
    /^(Aceite (Confort|de|para) labios|Bálsamo labial (ColorGel|KissKiss|Lip Jam)|Barra de labios|Brillo (de labios|labial)|Carcasa de labial|Embellecedor de labios|Gloss|Labial líquido|Lápiz de labios|Lipstick|Mousse de labios|Perfilador de labios|Recarga de labial|Tinte de labios)/,
    'lip-makeup',
  ],
  [
    /^(Cejas |Delineador|Eyeliner|Gel de cejas|Gel fijador de cejas|Graphik Ink Liner|Kajal|Laminador de cejas|Lápiz de cejas|Lápiz de ojos|Lápiz perfilador de cejas|Máscara|Micro lápiz perfilador de cejas|Paleta (de )?sombras|Perfilador de cejas|Perfilador de ojos|Perfilador Kajal|Rotulador de cejas|Set máscara de pestañas|Sombra|Tinte de cejas|Sculpture Brow)/,
    'eye-makeup',
  ],
  [
    /^(Colorete|Contorno en stick|Contouring|Gotas (bronceadoras|iluminadoras)|Iluminador|Paleta colorete|Perlas de polvos|Polvos?( |$)|Recarga de polvos)/,
    'powders-and-blush',
  ],
  [
    /^(Base de maquillaje|BB cream|BB Sports|Corrector|Maquillaje|Prebase|Recambio maquillaje|Recarga de maquillaje|Recarga maquillaje|Sérum corrector True Match|Fijador de maquillaje|Spray fijador de maquillaje)/,
    'face-makeup',
  ],
];
const KEPT_IN_FACIAL_CARE = [
  'A product whose name starts with "Estuche de maquillaje", "Maletín de maquillaje", "Paleta de maquillaje", "Set de maquillaje" or "Lote infantil de maquillaje": it holds products of several leaves. It is in the review list.',
  'A product on the Mercadona shelf "Maquillaje > Labios > Cuidado": lip care is facial care.',
  'A product on the Deza shelf "PERFUMERIA DIVA > Tratamientos" or on a Mercadona shelf under "Cuidado facial y corporal" (other than "Manicura y pedicura"), whatever its name starts with. A tinted cream there is in the review list.',
  'A product whose name no rule reads as make-up. If it is on the Deza shelf "PERFUMERIA DIVA > Color", it is in the review list.',
];

/** The other leaves: [leaf now, name pattern, brand or null, new leaf, leaves dropped too]. */
const PET =
  /^(Alfombra|Arnés|Bebedero|Bolso transportín|Cama |Casa cubierta|Caña juguete|Cinturón de seguridad|Cojín|Colgante|Collar (para|textil)|Comedero|Correa|Cuna|Juguete|Manta|Mordedor|Pelota|Rascador|Set alfombra|Transportín|Arenero|Pala de plástico para arenero)/;
const SHERRY_A =
  /^(Manzanilla muy fina|Vino manzanilla|Vino Pedro Ximénez|Vino dulce Pedro Ximénez|Vino amontillado|Vino fino|Vino oloroso|Vino dulce D\.O\. Montilla-Moriles)/;
const SHERRY_B =
  /^(Manzanilla muy fina|Vino manzanilla|Vino Pedro Ximénez|Vino amontillado|Vino fino|Vino oloroso|Oloroso D\.O\.|Vino solera|Vino dulce( |$))/;
const BAGS = 'batteries-kitchenware-and-bags';
const CANDLES = 'air-fresheners-refills-and-candles';
const CLOTHS = 'scouring-pads-cloths-and-gloves';
const OTHER_RULES = [
  ['dyes', /^Tinte de cejas/, 'Eylure', 'eye-makeup'],
  ['shower-gel-and-sponges', /^Cepillo de uñas/, null, 'nail-care'],
  [
    'parapharmacy',
    /^(Corta cutículas|Cortauñas pequeño|Cortaúñas manos y pies|Lima raspador de durezas para pies|Limas de cartón|Tijera de uñas)/,
    null,
    'nail-care',
  ],
  ['white-wine', SHERRY_A, null, 'sherry-and-fortified-wines', ['vermouth-and-aperitifs']],
  ['vermouth-and-aperitifs', SHERRY_B, null, 'sherry-and-fortified-wines', ['white-wine']],
  [
    'vermouth-and-aperitifs',
    /^(Cóctel mojito|Fino spritz|Spritz$)/,
    null,
    'premixed-drinks',
    ['ron-and-whisky'],
  ],
  [
    'ron-and-whisky',
    /^(Bebida preparada de ron|Cocktail mojito|Combinado de whisky|Cóctel mojito)/,
    null,
    'premixed-drinks',
    ['vermouth-and-aperitifs'],
  ],
  [
    'gin-vodka-and-tequila',
    /^(Combinado de vodka|Cóctel de ginebra|Cóctel gin tonic|Ginebra con tónica)/,
    null,
    'premixed-drinks',
  ],
  ['creams-liqueurs-and-brandy', /^Bebida de (lima|mango|sandía)$/, 'Breezer', 'premixed-drinks'],
  ['dog-treats-and-care', PET, null, 'pet-accessories', ['cat-treats-and-care']],
  ['cat-treats-and-care', PET, null, 'pet-accessories', ['dog-treats-and-care']],
  [
    BAGS,
    /^(Bombilla|Downlight|Lámpara LED|Linterna|Mini linterna|Adaptador|Base \d tomas|Base móvil|Clavija|Prolongador|Cable alargador)/,
    null,
    'lighting-and-electrical',
  ],
  [
    BAGS,
    /^(Batidor eléctrico|Batidora|Cafetera (Genio|Piccolo|de goteo|espresso|multicápsulas)|Envasadora|Espumador|Exprimidor inox 40 W|Freidora|Grill asar|Hervidor de agua|Horno eléctrico|Microondas|Placa vitrocerámica|Plancha de asar|Plancha de vapor|Sandwichera|Tostador|Dispensador de agua automático)/,
    null,
    'small-appliances',
  ],
  [
    BAGS,
    /^(Adhesivo|Cinta precortada|Cola (blanca|de contacto)|Pegamento|Puntos de fijación|Silicona|Bridas)/,
    null,
    'diy-and-hardware',
  ],
  [BAGS, /^Caja de ordenación/, null, 'storage-and-organisation'],
  [BAGS, /^(Bolsa de pan bordada|Manopla estampada)/, null, 'home-textiles'],
  [CLOTHS, /^Paño de cocina (bordado|piqué)/, null, 'home-textiles'],
  [
    'foams-and-fixers',
    /^(Cepillo alisador|Cepillo de aire caliente|Cepillo secador|Plancha de pelo|Rizador de pelo|Secador|Set moldeador)/,
    null,
    'small-appliances',
  ],
  ['fabric-softeners-and-laundry-care', /^Plancha de vapor/, null, 'small-appliances'],
  ['foams-and-fixers', /./, 'Ponette', 'hair-accessories'],
  [
    'dessert-mixes-and-decorations',
    /^(Velas? de cumpleaños|Bengala luminosa)/,
    null,
    'party-and-celebrations',
  ],
  [CANDLES, /^Velas? de cumpleaños/, null, 'party-and-celebrations'],
  [CANDLES, /^(Ambientador (de )?coche|Ambientador colgante y pinza Auto)/, null, 'car-care'],
  [
    'cleaning-floors-windows-and-furniture',
    /^(Lavaparabrisas|Limpia insectos|Limpiasalpicaderos)/,
    null,
    'car-care',
  ],
  [
    'cleaning-floors-windows-and-furniture',
    /^(Limpia tapicerías|Limpiacristales en spray)$/,
    'Lubrex',
    'car-care',
  ],
  [
    CLOTHS,
    /^(Esponja grande lava coche|Esponja limpiasalpicaderos|Bayeta microfibra 2 en 1 especial coche|Cepillo multiusos lavacoches)/,
    null,
    'car-care',
  ],
  [CANDLES, /^(Farol metálico|Vela led)/, null, 'home-decor'],
  [CLOTHS, /^Esponja de calzado/, null, 'shoe-care'],
  [
    CANDLES,
    /^(Desodorante de calzado|Ambientador para calzado|Elimina olores zapatos)/,
    null,
    'shoe-care',
  ],
  ['uncategorised', /^Libro /, null, 'books'],
  ['uncategorised', /^(Revista|Coleccionable)/, null, 'magazines-and-collectibles'],
  [
    'uncategorised',
    /^(Balón de cuero sintético|Pompero|Ventilador manual cangrejo)/,
    null,
    'toys-and-games',
  ],
  ['uncategorised', /^Portatodo/, null, 'stationery-and-school'],
  [
    'uncategorised',
    /^(Panel mandala|Gnomo músico|Campana de viento|Reloj de pared|Despertador)/,
    null,
    'home-decor',
  ],
  ['uncategorised', /^Birrete de graduación/, null, 'party-and-celebrations'],
];

function refileRules() {
  const dir = path.join(SRC, 'stage-c6/proposal');
  const moved = fs
    .readdirSync(dir)
    .sort()
    .flatMap((f) => J(`stage-c6/proposal/${f}`).products);
  const explained = new Set();
  const entries = [];
  const add = (rule, list, why, extra = {}) => {
    for (const p of list) explained.add(p.id);
    entries.push({
      rule,
      decision: { action: 'move-to-leaf', slug: rule.toLeaf },
      products: list.length,
      examples: list.slice(0, 3).map((p) => p.name),
      ...extra,
      status: REFILE,
      why,
    });
  };
  const onShelf = (p, re) => p.chainShelf.some((s) => re.test(s));

  const fromFacial = moved.filter((p) => p.dropped.includes('facial-care'));
  for (const [re, to] of MERCADONA_SHELF) {
    if (!to) continue;
    const list = fromFacial.filter(
      (p) =>
        p.why === 'Mercadona shelf' &&
        p.newCategory === to &&
        MERCADONA_SHELF.find(([r]) => onShelf(p, r))[0] === re
    );
    add(
      { fromLeaf: 'facial-care', shelfMatches: re.source, toLeaf: to },
      list,
      'The shelf of Mercadona names the leaf.'
    );
  }
  for (const [re, to] of MERCADONA_BY_NAME) {
    const list = fromFacial.filter(
      (p) =>
        p.why === 'Mercadona make-up shelf, leaf chosen by the name' &&
        p.newCategory === to &&
        re.test(p.name)
    );
    add(
      {
        fromLeaf: 'facial-care',
        shelfMatches: '^Mercadona: Maquillaje',
        nameMatches: re.source,
        toLeaf: to,
      },
      list,
      'The name says another leaf than the shelf of Mercadona. This rule wins over the shelf.'
    );
  }
  const byName = fromFacial.filter(
    (p) =>
      p.why === 'the name' ||
      p.why === 'Deza "Color" shelf, leaf chosen by the name'
  );
  for (const [re, to] of NAME_MAKEUP) {
    const list = byName.filter(
      (p) =>
        p.newCategory === to && NAME_MAKEUP.find(([r]) => r.test(p.name))[0] === re
    );
    add(
      { fromLeaf: 'facial-care', nameMatches: re.source, toLeaf: to },
      list,
      'The curated name says the leaf. The shelf paths of El Jamón do not describe the product, and the Deza shelf "Color" holds every kind of make-up.',
      {
        onTheDezaColorShelf: list.filter((p) => p.why !== 'the name').length,
      }
    );
  }
  for (const [from, re, brand, to, alsoDrops] of OTHER_RULES) {
    const list = moved.filter(
      (p) =>
        p.why.startsWith('was in ') &&
        p.newCategory === to &&
        p.dropped.includes(from) &&
        re.test(p.name) &&
        (!brand || p.brand === brand)
    );
    add(
      {
        fromLeaf: from,
        ...(re.source === '.' ? {} : { nameMatches: re.source }),
        ...(brand ? { brand } : {}),
        toLeaf: to,
        ...(alsoDrops ? { alsoLeaves: alsoDrops } : {}),
      },
      list,
      alsoDrops
        ? 'Both old leaves stood in for the missing leaf. A product that held both lost both.'
        : 'The old leaf stood in for the missing leaf.'
    );
  }
  return {
    entries,
    moved,
    unexplained: moved.filter((p) => !explained.has(p.id)),
  };
}

// ---------------------------------------------------------------------------------------
// The queue rows that were never in the second walk, by the reason of the first walk.
// `stage-c7/selection.json` holds each code with its count. A code is put in a group by its
// own words, in this order. The first group whose pattern fits takes the code.
// ---------------------------------------------------------------------------------------

const OUTSIDE_GROUPS = [
  ['unknown brand', /BRAND|LINE_|_LINE$/],
  [
    'several products',
    /SEVERAL_PRODUCTS|GIFT_SET$|BUNDLE|PROMO_PACK|MULTIPACK_MIXED|PACK_CONTENTS|CONTENTS_UNKNOWN/,
  ],
  [
    'unsure match',
    /DUPLICATE|SHARED_EAN|EAN_|CANDIDATE|_MATCH$|^AMBIGUOUS$|SAME_NAME|SAME_FORMAT|TWO_|FORMAT_MISMATCH|NEAR_|COLLIDES|POSSIBLE_|LINK_TARGET/,
  ],
  [
    'unreadable size',
    /FORMAT|MULTIPACK|PACK|SIZE|WEIGHT|UNIT_|DIMENSION|CONTAINER|MINI_VS_REGULAR/,
  ],
  ['unclear', /./],
];
function rowsOutsideTheWalk(selection) {
  const groups = Object.fromEntries(
    OUTSIDE_GROUPS.map(([name]) => [name, { rows: 0, codes: {} }])
  );
  for (const [key, n] of Object.entries(selection.notSelectedByLastLogLine)) {
    const code = key.split(' / ')[1];
    const [name] = OUTSIDE_GROUPS.find(([, re]) => re.test(code));
    groups[name].rows += n;
    groups[name].codes[code] = (groups[name].codes[code] ?? 0) + n;
  }
  for (const g of Object.values(groups)) {
    const all = Object.entries(sorted(g.codes));
    g.largestCodes = Object.fromEntries(all.slice(0, 6));
    g.otherCodes = all.length - Math.min(all.length, 6);
    delete g.codes;
  }
  return groups;
}

export function stageD() {
  const out = [];

  // ---- D1, the rules of the re-file ---------------------------------------------------
  {
    startGaps();
    const { entries, moved, unexplained } = refileRules();
    const summary = J('stage-c6/proposal.summary.json');
    out.push(
      writeData(
        'd01-refile-rules.json',
        {
          step: 'D1',
          title:
            'The re-file of 2026-10-07: the rule that moved each product onto a leaf of plan 0179',
          sources: [
            'stage-c6/propose.mjs',
            'stage-c6/proposal/<leaf>.json',
            'stage-c6/proposal.summary.json',
          ],
          keys: 'An entry is a rule and not a product. A rule names the leaf that a product is in, a test on its curated Spanish name (a regular expression), sometimes its brand or the shelf of its chain, and the leaf it goes to. `products` is the count of moved products that the rule explains, and `examples` holds three of their names.',
          decidedBy:
            'The session of stage c6, which wrote each rule after it read the names that the rule matches. Plan 0179 named the leaves.',
          fullRecord:
            'stage-c6/proposal/<leaf>.json holds each of the moved products with its old and its new categories. It is too large for this folder.',
          productsMoved: moved.length,
          productsThatNoRuleOfThisFileExplains: unexplained.length,
          productsLeftForAPerson: summary.review,
          facialCare: {
            before: summary.facialCareBefore,
            after: summary.facialCareAfter,
          },
          orderOfTheMakeupRules:
            'A product in `facial-care` is tried against the review names first, then the shelf of Mercadona, then the care shelves that keep their products, then the name. The first rule that fits decides.',
          keptInFacialCare: KEPT_IN_FACIAL_CARE,
          aProductThatKeptAnotherCategory:
            'A product keeps every category that no rule drops. The new leaf takes the position of the leaf it replaces. 7 Shiseido "BB Sports" keep `sunscreen`, and one vacuum sealer keeps `film-aluminum-and-preservation`.',
          mirroredRules:
            'The two sherry rules, the two pet rules and two of the premixed drink rules mirror each other. A product that held both old leaves is counted under both rules: 9 sherries, 37 pet accessories and 1 mojito.',
          perLeaf: Object.fromEntries(
            Object.entries(summary.perLeaf).map(([slug, v]) => [
              slug,
              { es: v.es, products: v.count, from: v.from },
            ])
          ),
          makeupPerSource: summary.makeupPerSource,
        },
        entries
      )
    );
  }

  // ---- D2, the review list of the re-file ---------------------------------------------
  const before7 = new Map(
    J('stage-c7/applied/items.before.json').map((i) => [i.id, i])
  );
  {
    startGaps();
    const entries = J('stage-c6/review.json').products.map((p) => ({
      product: product(p.id, itemState(before7.get(p.id))),
      decision: { action: 'none' },
      status: 'left for a person',
      categories: p.categories,
      chainShelf: p.chainShelf,
      why: p.reason,
    }));
    out.push(
      writeData(
        'd02-refile-left-for-a-person.json',
        {
          step: 'D2',
          title:
            'The re-file of 2026-10-07: the products that a rule doubted and left where they are',
          sources: ['stage-c6/review.json', 'stage-c7/applied/items.before.json'],
          keys: 'Each product is keyed as it stood at the end of the re-file, which changed no name, brand, size or barcode. `categories` holds the leaves it was left in.',
          decidedBy:
            'Nobody yet. The session of stage c6 sent nothing for these products. A person decides each one.',
          byReason: sorted(count(entries, (e) => e.why)),
        },
        entries
      )
    );
  }

  // ---- D3, the brand answers of the second walk ---------------------------------------
  const plan = J('stage-c7/brands/apply-plan.json');
  {
    startGaps();
    const outcome = new Map(
      J('stage-c7/brands/applied.summary.json').outcomes.map((o) => [
        o.spelling,
        o,
      ])
    );
    const original = {};
    const final = {};
    for (let n = 1; n <= 9; n++) {
      const f = `stage-c7/brands/BR-0${n}.answer.json`;
      Object.assign(final, J(f));
      if (fs.existsSync(path.join(SRC, `${f}.decider-original`)))
        Object.assign(original, J(`${f}.decider-original`));
    }
    const sent = (a, action) => ({
      printedBrand: a.spelling,
      key: a.key,
      packet: a.packet,
      decision: { action, label: a.label },
      status:
        outcome.get(a.spelling)?.status === 201 ? WALK : 'not applied',
      ...(a.key === a.labelKey
        ? {}
        : { thePrintedTextBecameASpellingOf: a.label }),
      rowsOfTheWalk: a.rowsOfTheWalk,
      why: a.reason,
    });
    const entries = [
      ...plan.register.map((a) => sent(a, 'REGISTER')),
      ...plan.spellingOf.map((a) => sent(a, 'SPELLING_OF')),
      ...plan.skipped
        .filter((a) => a.action === 'REVIEW')
        .map((a) => {
          const was = original[a.key];
          const changed =
            was && JSON.stringify(was) !== JSON.stringify(final[a.key]);
          return {
            printedBrand: a.spelling,
            key: a.key,
            packet: a.packet,
            decision: { action: 'REVIEW' },
            status: 'left for a person',
            ...(changed
              ? {
                  answerOfTheDecider: {
                    action: was.action,
                    label: was.label,
                    why: was.reason,
                  },
                  changedBy: 'The session of stage c7, before the brands were sent.',
                }
              : {}),
            rowsOfTheWalk: a.rowsOfTheWalk,
            samples: a.samples,
            why: a.reason,
          };
        }),
    ];
    const notABrand = plan.skipped.filter((a) => a.action === 'NOT_A_BRAND');
    out.push(
      writeData(
        'd03-second-walk-brands.json',
        {
          step: 'D3',
          title:
            'The second walk of 2026-10-07: the printed brands that the registry did not hold',
          sources: [
            'stage-c7/brands/apply-plan.json',
            'stage-c7/brands/applied.summary.json',
            'stage-c7/brands/BR-NN.answer.json',
            'stage-c7/brands/BR-NN.answer.json.decider-original',
          ],
          keys: 'A printed brand is keyed by the text that the chain printed and by its normalized key. A brand is keyed by its label.',
          decidedBy:
            'Blind brand deciders, one answer file for each of nine packets. The session of stage c7 changed seven of their answers to REVIEW before anything was sent. Each of the seven holds `answerOfTheDecider`.',
          fullRecord:
            'stage-c7/brands/skipped.jsonl holds the printed texts that are not a brand, each with its reason. stage-c7/brands/applied.jsonl holds each request with its answer.',
          spellingsRead: entries.length + notABrand.length,
          notABrand: {
            count: notABrand.length,
            byPacket: count(notABrand, (a) => a.packet),
            largestReasons: Object.fromEntries(
              Object.entries(sorted(count(notABrand, (a) => a.reason))).slice(
                0,
                8
              )
            ),
          },
          byAction: count(entries, (e) => e.decision.action),
        },
        entries
      )
    );
  }

  // ---- The rows of the walk -----------------------------------------------------------
  const walkRows = J('stage-c7/work/entries.json');
  const selection = J('stage-c7/selection.json');
  const groupOf = new Map(selection.rows.map((r) => [r.entryId, r.group]));
  const R = (id) => row(id, walkRows[id] ? rowState(walkRows[id]) : null);
  const adjustments = JL('stage-c7/adjustments.jsonl');

  // ---- D4, the corrections before the batches were sent -------------------------------
  {
    startGaps();
    const CLASS = {
      C1_SIZE_UNREADABLE: 'Correction 1: the printed measure cannot be read.',
      C2_SEVERAL_PRODUCTS:
        'Correction 2: a colour printed with a slash may be a choice of two products.',
      C2_SLASH_LEFT:
        'Correction 2, left: a pen set prints the colours of its pens, one of each.',
      C3_AMBIGUOUS_CANDIDATE:
        'Correction 3: the decider itself noted that the candidate differs.',
      C3_REF_LINK_LEFT:
        'Correction 3, left: a promotion row with no price, bound to the magazine that the same batch created.',
      C4_BRAND_HOMONYM:
        'Correction 4: the registry holds the printed word as a brand of another kind of goods.',
    };
    const entries = adjustments
      .filter((a) => a.class !== 'C1_HEIGHT_ADDED')
      .map((a) => ({
        row: R(a.entryId),
        batch: a.batch,
        correction: a.class,
        answerOfTheDecider: a.before,
        decision: a.after,
        status:
          a.after.decision === 'REVIEW'
            ? 'changed to REVIEW, left for a person'
            : 'left as the decider answered, ' + WALK,
        why: CLASS[a.class],
        detail: a.reason,
      }));
    const heights = adjustments.filter((a) => a.class === 'C1_HEIGHT_ADDED');
    const tally = J('stage-c7/applied/finals.summary.json').tally;
    out.push(
      writeData(
        'd04-second-walk-corrections.json',
        {
          step: 'D4',
          title:
            'The second walk of 2026-10-07: what the session corrected in the answers before it sent them',
          sources: [
            'stage-c7/adjustments.jsonl',
            'stage-c7/applied/finals.summary.json',
            'stage-c7/work/entries.json',
          ],
          keys: 'Each queue row is keyed as it stood when the packets were built (stage-c7/work/entries.json).',
          decidedBy:
            'The session of stage c7, by rules R47 and R51 to R53 of the README. Section 6 of the README holds the table of the corrections. No answer file of a decider was edited: each correction stands in a final file beside it.',
          fullRecord:
            'stage-c7/adjustments.jsonl holds one line for each change, the 160 heights among them.',
          heightAddedToBothNames: {
            rule: 'A CREATE of batches B-017 to B-020 whose Spanish name holds the word "artificial" ends in the printed height in both names. The floral foam is not a flower and is left out.',
            rows: heights.length,
            byBatch: count(heights, (a) => a.batch),
            rowsThatAlreadyCarriedTheHeight: tally.C1_ALREADY_CARRIED,
            example: {
              printedName: heights[0].printed,
              sizeFormat: heights[0].sizeFormat,
              before: heights[0].before.nameEs,
              after: heights[0].after.nameEs,
            },
          },
          checkedAndNothingFound: [
            'Correction 5: a CREATE that the live catalog already held. Checked before each batch by brand, normalized Spanish name, size in the base unit and pack count.',
            'Two CREATEs of the walk that are equal after the corrections, inside a batch or across batches.',
            'Correction 6: an answer that writes the lone letter "G" as a brand or in a name.',
          ],
          byCorrection: count(entries, (e) => e.correction),
        },
        entries
      )
    );
  }

  // ---- D5, the rows of the walk that stay in the queue --------------------------------
  {
    startGaps();
    const bySession = new Set(
      adjustments
        .filter((a) => a.after.decision === 'REVIEW')
        .map((a) => a.entryId)
    );
    const entries = JL('stage-c7/review.jsonl')
      .filter((l) => l.kind === 'review')
      .map((l) => ({
        row: R(l.entryId),
        batch: l.batch,
        group: groupOf.get(l.entryId),
        decision: { action: 'REVIEW', code: l.reason },
        status: 'left for a person',
        leftBy: bySession.has(l.entryId)
          ? 'a correction of the session'
          : 'the answer of the decider',
        why: l.issues.map((i) => i.detail).join(' '),
      }));
    const chain = (e) => `${e.row.chain} ${e.row.sourceKind}`;
    out.push(
      writeData(
        'd05-second-walk-left-in-the-queue.json',
        {
          step: 'D5',
          title:
            'The second walk of 2026-10-07: the rows that got no operation and stay in the queue',
          sources: [
            'stage-c7/review.jsonl',
            'stage-c7/adjustments.jsonl',
            'stage-c7/selection.json',
            'stage-c7/work/entries.json',
          ],
          keys: 'Each queue row is keyed as it stood when the packets were built (stage-c7/work/entries.json). `group` is 1 for a row that the driver of the first walk skipped, 2 for a row that a decider of the first walk left with no category, and 3 for a row first seen after the first walk.',
          decidedBy:
            'A blind product decider (Opus) for each row, or a correction of the session of stage c7. `leftBy` says which.',
          byCode: sorted(count(entries, (e) => e.decision.code)),
          byChain: count(entries, chain),
          byGroup: count(entries, (e) => `group ${e.group}`),
          byWhoLeftIt: count(entries, (e) => e.leftBy),
          rowsOutsideTheWalk: {
            rows: selection.notSelected,
            note: 'These rows were never in the second walk. No file of this folder holds them one by one. Each kept the reason code of the first walk, and the codes are grouped here by their own words (build/stage-d.mjs, OUTSIDE_GROUPS). The review logs of the first walk hold each row.',
            byGroup: rowsOutsideTheWalk(selection),
          },
        },
        entries
      )
    );
  }

  // ---- D6, the rows bound to a product that exists ------------------------------------
  {
    startGaps();
    const after7 = new Map(
      J('stage-c7/applied/items.after.json').map((i) => [i.id, i])
    );
    const changed = new Map(
      J('stage-c7/applied/verify.json').productsFromBeforeTheWalk.changes.map(
        (c) => [c.id, c]
      )
    );
    const entries = JL('stage-c7/applied/linked.jsonl').map((l) => {
      const old = before7.has(l.itemId);
      const taught = changed.get(l.itemId);
      return {
        row: R(l.entryId),
        batch: l.batch,
        decision: { action: 'accept' },
        product: {
          ...product(
            l.itemId,
            itemState(old ? before7.get(l.itemId) : after7.get(l.itemId))
          ),
          ...(old ? {} : { nameEn: after7.get(l.itemId).name.en }),
        },
        theProductIs: old
          ? 'a product from before the walk'
          : 'a product that the same batch created',
        ...(taught
          ? { barcodeTaughtToTheProduct: taught.after.ean }
          : {}),
        status: WALK,
      };
    });
    const created = JL('stage-c7/applied/created.jsonl');
    out.push(
      writeData(
        'd06-second-walk-links.json',
        {
          step: 'D6',
          title:
            'The second walk of 2026-10-07: the rows that were accepted onto a product, and the count of the products created',
          sources: [
            'stage-c7/applied/linked.jsonl',
            'stage-c7/applied/created.jsonl',
            'stage-c7/applied/verify.json',
            'stage-c7/applied/items.before.json',
            'stage-c7/applied/items.after.json',
          ],
          keys: 'Each queue row is keyed as it stood when the packets were built. A product from before the walk is keyed as it stood before the walk. A product that the walk created is keyed as it stood after it.',
          decidedBy:
            'A blind product decider (Opus) for each row. The session of stage c7 changed two other links to REVIEW (d04).',
          fullRecord:
            'stage-c7/applied/created.jsonl holds each of the products that the walk created, with the row that made it. It is too large for this folder.',
          productsCreated: {
            count: created.length,
            withABrand: created.filter((c) => c.brand).length,
            withNoBrand: created.filter((c) => !c.brand).length,
            byFirstLeaf: sorted(count(created, (c) => c.categorySlugs[0])),
            byBatch: count(created, (c) => c.batch),
          },
        },
        entries
      )
    );
  }

  return out;
}
