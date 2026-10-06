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
