// What the owner answered on 2026-10-06 to the sixteen decisions of section 4 of the
// README. The build writes the answer beside every `openDecision` number, so that a data
// file says by itself how its rows were decided. The key `openDecision` keeps its name:
// it is the number of the row in section 4, and the row is no longer open.
//
// These sentences are the owner's word as the directing session relayed it. They are not
// read from a file of the repair. Change one here and build again.
const DECIDED = 'Decided by the owner, 2026-10-06: ';
const HELD = 'Held by the owner, 2026-10-06: ';

export const OWNER_DECISIONS = {
  1:
    DECIDED +
    'no revert and no second import. The next leaflet goes through the fixed code.',
  2:
    DECIDED +
    'the row gets a product of its own, created from the row, with the container in the name. The Coca-Cola rows take a pack count after their detail is read.',
  3:
    DECIDED +
    'GRAM with the weight that price over unit price gives, when it lands within 1 percent of a round pack weight. Else left for a person.',
  4:
    DECIDED +
    'the ten shop codes are mapped by their street names to the Deza shops of the catalog. CONSULTAR is ignored and never mapped.',
  5: DECIDED + 'left, no write.',
  6:
    DECIDED +
    'merge only when the rows of both products agree on count and weight. Keep the product in grams or millilitres and put the count in the pack count.',
  7:
    DECIDED +
    'the candidate is not accepted. The row is bound to the product of its own brand when one exists, else a product is created from the row.',
  8:
    DECIDED +
    'the three proper names stay as they are in English. "Sugar free angel hair pastries" for the fourth.',
  9:
    HELD +
    'the owner checks whether the pairs are duplicates. No merge, and the Flora product is not moved.',
  10:
    DECIDED +
    'the row gets a product of its own, 240 g as printed. A printed size wins over a size worked out from a unit price.',
  11:
    DECIDED +
    'the product whose Mercadona row is sold by weight is the loose fruit and takes every loose row of the other chains. The other is the bag and stays its own product with a size.',
  12:
    DECIDED +
    'Nike Ultra Blue, Vileda Turbo, Vileda Duactiva, Nescafé Farmers Origins, Neutrex Transpirex and Lenor Unstoppables join their house with the word in the product name. Puleva Max stays. Invictus is linked to Paco Rabanne after its spelling points there. The five links an agent made stay.',
  13: DECIDED + 'kept as MILLILITER.',
  14:
    DECIDED + 'KILOGRAM with no size if its row is sold by weight. Else left.',
  15: DECIDED + 'left until the next Mercadona run prints the size again.',
  16: DECIDED + 'wait for the code fix of plan 0191. No manual write.',
};

// What the owner answered later on 2026-10-06, after the register was written, to the rows
// that the stages of plan 0192 left. `stage-c.mjs` writes each one as
// `ownerAnswerAfterTheRegister`. The sixteen answers above stay as they were first given,
// so that the files of plan 0186 build byte for byte as before.
const LATER = 'Decided by the owner, 2026-10-06, after the register was written: ';

export const ANSWERS_AFTER_THE_REGISTER = {
  duplicates:
    LATER +
    'each of the four probable duplicates is one product. Merge them, with the names of the pair as the product names.',
  shops:
    LATER +
    'C1 is the shop at Imprenta de la Alborada 116, Z1 the shop at José María Martorell, and C2 the shop at Libertador Sucre 38.',
  discovery: LATER + 'a store discovery for T2 and T7.',
  offersWithNoPrice:
    LATER + 'the offers with no price that a mapping writes stay.',
  ownProduct: LATER + 'the row gets a product of its own.',
  coren:
    LATER +
    'the row is accepted onto the Coren product, and that product is renamed "Albóndigas de pollo".',
  marcilla:
    LATER + 'merge the pair, with "Marcilla" in the name of the kept product.',
  vanilla: LATER + 'the Nescafé vanilla pair stays two products.',
  bref: LATER + 'the Bref pair waits for a barcode.',
  fruit:
    LATER +
    'the product with the singular name is the loose fruit, and the product with the plural name is the bag. The 1.5 kg Golden bag is a product of its own.',
  paella: LATER + 'the paella mix stays without a size.',
  candle: LATER + 'the candle of 1 unit stays.',
  cocaCola: LATER + 'the Coca-Cola packs stay as pack count 4.',
  fanta: LATER + 'Fanta naranja stays 1,500 ml. A printed size wins.',
};

// What the owner answered on 2026-10-07, after the final dumps of plan 0192 were taken.
// `stage-c.mjs` writes each one as `ownerAnswerOf20261007`. The first two changed data, so
// new dumps were taken. The files of that session stand in `stage-c4/`. The last one came
// after those dumps and changed data too, so the dumps were taken once more. Its files
// stand in `stage-c5/`.
const NEXT_DAY = 'Decided by the owner, 2026-10-07: ';

export const ANSWERS_OF_2026_10_07 = {
  t7:
    NEXT_DAY +
    'the shop of T7 is the one on the page of the chain, https://www.dezacalidad.es/centros/avda-virgen-de-las-angustias/ ("Tienda 7 - Supermercado Deza Calidad SA en Calle Acera Fuente de la Salud, 14006 - Córdoba"). The shop is created and the code is mapped to it.',
  shoeCreams:
    NEXT_DAY +
    'the three shoe creams go into the leaf "Cuidado del calzado". No category is created.',
  kiwis: NEXT_DAY + 'the El Jamón row "kiwis" on "Kiwi verde" is fine.',
  looseFruit:
    NEXT_DAY +
    'the loose fruit rows that sit on other products are left for now. They are fixed another time, and a small report of them is saved.',
  t7Coordinates:
    NEXT_DAY +
    'the coordinates of the shop of T7 are 37.89862387806124, -4.772603355414682. The owner read them from Google Maps.',
};

/** The entry with the answer of the owner beside its decision number. */
export function withOwnerDecision(entry) {
  if (!('openDecision' in entry)) return entry;
  const out = {};
  for (const [k, v] of Object.entries(entry)) {
    out[k] = v;
    if (k === 'openDecision') out.ownerDecision = OWNER_DECISIONS[v];
  }
  return out;
}
