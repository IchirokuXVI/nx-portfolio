/**
 * The leaves of Luna Shopper's category taxonomy, by root (backend plan 0166,
 * appendix A).
 *
 * **This is a copy, and it exists so that a typo fails a test.** The catalog's
 * reference seed owns the taxonomy and turns each slug into a row; this library
 * knows no ids and no database, so the only thing its resolver can answer is a
 * slug, and the only way to prove a slug it answers is real is to hold the list
 * here. `categories.spec.ts` asserts every slug the table names is one of these.
 *
 * A slug is an identity and never renamed after it ships, so the copy only ever
 * grows. A leaf added to the seed and not here is harmless: nothing here answers
 * it until the table is taught to.
 */
export const CATEGORY_LEAVES: Readonly<Record<string, readonly string[]>> = {
  'fruit-and-vegetables': [
    'fruit',
    'vegetables',
    'salads-and-herbs',
    'nuts-and-dried-fruit',
    'other-produce',
  ],
  meat: [
    'poultry',
    'pork',
    'beef-and-lamb',
    'minced-and-burgers',
    'other-meat',
  ],
  'cold-cuts-and-cheese': [
    'cured-ham-and-sausages',
    'sliced-cold-cuts',
    'cheese',
    'pates-and-spreads',
    'other-cold-cuts',
  ],
  'fish-and-seafood': [
    'fresh-fish',
    'shellfish',
    'smoked-and-salted-fish',
    'other-seafood',
  ],
  'dairy-and-eggs': [
    'milk',
    'plant-drinks',
    'yogurts-and-desserts',
    'butter-and-cream',
    'eggs',
    'other-dairy',
  ],
  bakery: [
    'bread',
    'pastries-and-cakes',
    'toasts-and-crispbread',
    'other-bakery',
  ],
  'breakfast-and-sweets': [
    'cereals',
    'biscuits',
    'jam-honey-and-spreads',
    'chocolate-and-sweets',
    'coffee-tea-and-cocoa',
    'other-breakfast',
  ],
  pantry: [
    'pasta-rice-and-legumes',
    'canned-food',
    'oil-and-vinegar',
    'sauces-and-condiments',
    'flour-sugar-and-baking',
    'spices-and-salt',
    'soups-and-stock',
    'other-pantry',
  ],
  frozen: [
    'frozen-vegetables',
    'frozen-fish-and-seafood',
    'frozen-meals-and-pizzas',
    'ice-cream',
    'other-frozen',
  ],
  'ready-meals': [
    'pizzas',
    'prepared-dishes',
    'salads-and-sandwiches',
    'fresh-pasta-and-dough',
    'other-ready-meals',
  ],
  snacks: ['crisps', 'salty-snacks', 'olives-and-pickles', 'other-snacks'],
  drinks: [
    'water',
    'soft-drinks',
    'juices',
    'beer',
    'wine-and-cava',
    'spirits',
    'other-drinks',
  ],
  baby: ['baby-food', 'nappies-and-wipes', 'other-baby'],
  pets: ['dogs', 'cats', 'other-pets'],
  household: [
    'cleaning',
    'laundry',
    'dishwashing',
    'paper-and-wipes',
    'bags-foil-and-wrap',
    'other-household',
  ],
  'personal-care': [
    'hair',
    'skin-and-body',
    'oral-care',
    'shaving-and-deodorant',
    'feminine-care',
    'pharmacy',
    'other-personal-care',
  ],
  other: ['uncategorised'],
};

/** Every leaf slug, for the membership check. */
export const CATEGORY_LEAF_SLUGS: ReadonlySet<string> = new Set(
  Object.values(CATEGORY_LEAVES).flat()
);
