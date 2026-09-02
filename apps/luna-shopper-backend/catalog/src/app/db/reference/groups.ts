import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import type { ReferenceGroup } from './types';

/**
 * The normalized product groups the reference catalog is built around (plan
 * 0067, section 2).
 *
 * A group is **the thing you would write on a shopping list**, which is the
 * grain the whole file is authored at and the only one worth defending. Coarser
 * and it stops being a purchase: "dairy" is a supermarket aisle, and nobody
 * writes it down. Finer and every product becomes its own group, which is the
 * un-normalized catalog again under a friendlier name. So `Chorizo` and
 * `Salchichón` are two groups because you would say which one you meant, while
 * every brand and size of chorizo is one.
 *
 * The English name is the friendly name plan 0067 asks for. The Spanish one is
 * not a translation of it but the word actually used here, which is why several
 * groups keep a Spanish name in the English field (`Fuet`, `Torreznos`): there
 * is no English word for them and inventing one would make the group unfindable
 * in the language it is shopped in.
 *
 * `synonyms` is what makes a group reachable from either language, and it earns
 * its place on the receipt names: nothing about `GRIEGO LIMÓN` or `+PROT
 * NATILLA VAINI` leads to a group by its name alone, so the abbreviations the
 * tills print are listed beside the ordinary words.
 */
export const REFERENCE_GROUPS: ReferenceGroup[] = [
  // --- Produce -------------------------------------------------------------
  {
    slug: 'bananas',
    name: { en: 'Bananas', es: 'Plátanos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['banana', 'bananas'],
      es: ['plátano', 'plátanos', 'banana'],
    },
  },
  {
    slug: 'aubergines',
    name: { en: 'Aubergines', es: 'Berenjenas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['aubergine', 'eggplant'],
      es: ['berenjena', 'berenjenas'],
    },
  },
  {
    slug: 'mushrooms',
    name: { en: 'Mushrooms', es: 'Champiñones' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['mushroom', 'button mushroom'],
      es: ['champiñón', 'champiñones', 'setas'],
    },
  },
  {
    slug: 'grilled-vegetables',
    name: { en: 'Grilled Vegetable Mix', es: 'Parrillada de verduras' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['grilled vegetables', 'vegetable mix'],
      es: ['parrillada', 'verduras a la parrilla'],
    },
  },

  // --- Fish counter --------------------------------------------------------
  {
    slug: 'fresh-anchovies',
    name: { en: 'Fresh Anchovies', es: 'Boquerones frescos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['anchovy', 'anchovies'], es: ['boquerón', 'boquerones'] },
  },
  {
    slug: 'meagre',
    name: { en: 'Meagre', es: 'Corvina' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['meagre', 'croaker'], es: ['corvina'] },
  },
  {
    slug: 'sea-bream',
    name: { en: 'Sea Bream', es: 'Dorada' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['sea bream', 'gilt head bream'], es: ['dorada'] },
  },
  {
    slug: 'rainbow-trout',
    name: { en: 'Rainbow Trout', es: 'Trucha arco iris' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['trout', 'rainbow trout'],
      es: ['trucha', 'trucha arco iris'],
    },
  },
  {
    slug: 'mackerel',
    name: { en: 'Mackerel', es: 'Caballa' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['mackerel', 'chub mackerel'],
      es: ['caballa', 'estornino'],
    },
  },
  {
    slug: 'surimi-sticks',
    name: { en: 'Surimi Sticks', es: 'Palitos de surimi' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['surimi', 'crab sticks'],
      es: ['surimi', 'palitos de cangrejo'],
    },
  },
  {
    slug: 'tinned-tuna',
    name: { en: 'Tinned Tuna', es: 'Atún en lata' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['tuna', 'canned tuna'], es: ['atún', 'atún claro'] },
  },
  {
    slug: 'tinned-sardines',
    name: { en: 'Tinned Sardines', es: 'Sardinas en lata' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['sardines', 'canned sardines'], es: ['sardinas'] },
  },
  {
    slug: 'tinned-small-sardines',
    name: { en: 'Tinned Small Sardines', es: 'Sardinillas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    // Its own group rather than a size of the one above: the tills price and
    // stock them separately and a list saying "sardinas" does not mean these.
    synonyms: { en: ['small sardines', 'sardinillas'], es: ['sardinillas'] },
  },

  // --- Meat and charcuterie ------------------------------------------------
  {
    slug: 'frankfurter-sausages',
    name: { en: 'Frankfurter Sausages', es: 'Salchichas Frankfurt' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['frankfurters', 'hot dog sausages'],
      es: ['salchichas frankfurt', 'frankf', 'salch frankf'],
    },
  },
  {
    slug: 'vienna-sausages',
    name: { en: 'Vienna Sausages', es: 'Salchichas Viena' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['vienna sausages'],
      es: ['salchichas viena', 'frankfurt viena'],
    },
  },
  {
    slug: 'cooked-sausages',
    name: { en: 'Cooked Sausages', es: 'Salchichas cocidas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['cooked sausages', 'bratwurst'],
      es: ['salchichas cocidas', 'salchichas gourmet'],
    },
  },
  {
    slug: 'fuet',
    name: { en: 'Fuet', es: 'Fuet' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['fuet', 'espetec', 'catalan dry sausage'],
      es: ['fuet', 'espetec'],
    },
  },
  {
    slug: 'salami',
    name: { en: 'Salami', es: 'Salami' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['salami'], es: ['salami', 'salami montañés'] },
  },
  {
    slug: 'salchichon',
    name: { en: 'Salchichón', es: 'Salchichón' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['salchichon', 'spanish summer sausage'],
      es: ['salchichón'],
    },
  },
  {
    slug: 'chorizo',
    name: { en: 'Chorizo', es: 'Chorizo' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['chorizo'], es: ['chorizo', 'chorizo pamplona'] },
  },
  {
    slug: 'serrano-ham',
    name: { en: 'Serrano Ham', es: 'Jamón serrano' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['serrano ham', 'cured ham'],
      es: ['jamón serrano', 'jamón curado'],
    },
  },
  {
    slug: 'diced-ham',
    name: { en: 'Diced Ham', es: 'Taquitos de jamón' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['diced ham', 'ham cubes'],
      es: ['taquitos de jamón', 'mini taquitos'],
    },
  },
  {
    slug: 'sliced-turkey-breast',
    name: { en: 'Sliced Turkey Breast', es: 'Pechuga de pavo' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['turkey breast', 'sliced turkey'],
      es: ['pechuga de pavo', 'fiambre de pavo'],
    },
  },
  {
    slug: 'mortadella',
    name: { en: 'Mortadella', es: 'Mortadela' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['mortadella', 'bologna'], es: ['mortadela'] },
  },
  {
    slug: 'chopped-pork',
    name: { en: 'Chopped Pork', es: 'Chopped pork' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['chopped pork', 'luncheon meat'],
      es: ['chopped', 'chopped pork'],
    },
  },
  {
    slug: 'head-cheese',
    name: { en: 'Head Cheese', es: 'Cabeza de jabalí' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['head cheese', 'brawn'], es: ['cabeza de jabalí'] },
  },
  {
    slug: 'pork-terrine',
    name: { en: 'Pork Terrine', es: 'Budín de cerdo' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['pork terrine', 'pork loaf'],
      es: ['budín de cerdo', 'budín'],
    },
  },
  {
    slug: 'cooked-shoulder-ham',
    name: { en: 'Cooked Shoulder Ham', es: 'Fiambre de paleta' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['shoulder ham', 'cooked ham'],
      es: ['fiambre de paleta', 'paleta sándwich'],
    },
  },
  {
    slug: 'bacon',
    name: { en: 'Bacon', es: 'Bacon' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['bacon', 'smoked bacon'],
      es: ['bacon', 'beicon', 'tiras de bacon'],
    },
  },
  {
    slug: 'pate',
    name: { en: 'Pâté', es: 'Paté' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['pate', 'liver pate'], es: ['paté', 'paté de campaña'] },
  },
  {
    slug: 'pork-crackling',
    name: { en: 'Pork Crackling', es: 'Torreznos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['pork crackling', 'pork scratchings'],
      es: ['torreznos', 'torreznillos', 'cortezas'],
    },
  },
  // No `butcher-counter` group, and none for the greengrocer either. Four
  // receipt lines name the counter that rang the sale up rather than anything
  // that came off it — `CARNICERIA`, `CHARCUTERIA`, `PANADERIA`, `Fruteria
  // CASH2` — and a department is not a thing you can buy again, which is the
  // only test a group here has to pass.

  // --- Dairy, eggs and desserts -------------------------------------------
  {
    slug: 'lactose-free-milk',
    name: {
      en: 'Lactose Free Semi Skimmed Milk',
      es: 'Leche semidesnatada sin lactosa',
    },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['lactose free milk', 'semi skimmed milk'],
      es: ['leche sin lactosa', 'leche semi'],
    },
  },
  {
    slug: 'greek-yogurt',
    name: { en: 'Greek Yogurt', es: 'Yogur griego' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['greek yogurt', 'greek yoghurt'],
      es: ['yogur griego', 'griego'],
    },
  },
  {
    slug: 'childrens-yogurt',
    name: { en: "Children's Yogurt", es: 'Yogur infantil' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['kids yogurt', 'yogomix'],
      es: ['yogur infantil', 'yogomix'],
    },
  },
  {
    slug: 'drinking-yogurt',
    name: { en: 'Drinking Yogurt', es: 'Yogur líquido' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['drinking yogurt', 'liquid yogurt'],
      es: ['yogur líquido', 'yogur para beber'],
    },
  },
  {
    slug: 'protein-dessert',
    name: { en: 'Protein Dessert', es: 'Postre proteico' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['protein dessert', 'protein pudding'],
      es: ['postre proteico', 'prot natilla', 'natillas proteínas'],
    },
  },
  // No plain `custard` group, though the obvious taxonomy wants one: the only
  // natillas on any of these receipts is the +Proteínas one, which belongs with
  // the protein desserts. A group with no members would describe a catalog
  // nothing here holds, and `reference-catalog.spec.ts` fails on one.
  {
    slug: 'panna-cotta',
    name: { en: 'Panna Cotta', es: 'Panna cotta' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['panna cotta'], es: ['panna cotta'] },
  },
  {
    slug: 'chocolate-mousse',
    name: { en: 'Chocolate Mousse', es: 'Mousse de chocolate' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['chocolate mousse'],
      es: ['mousse de chocolate', 'mousse choco'],
    },
  },
  {
    slug: 'creme-caramel',
    name: { en: 'Crème Caramel', es: 'Flan' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['flan', 'creme caramel', 'egg custard'],
      es: ['flan', 'flan de huevo', 'flan de vainilla'],
    },
  },
  {
    slug: 'whisky-cake',
    name: { en: 'Whisky Cake Dessert', es: 'Tarta al whisky' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['whisky cake'], es: ['tarta al whisky'] },
  },
  {
    slug: 'sliced-cheese',
    name: { en: 'Sliced Cheese', es: 'Queso en lonchas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['sliced cheese', 'cheese slices'],
      es: ['queso en lonchas', 'lonchas de queso'],
    },
  },
  {
    slug: 'grated-cheese',
    name: { en: 'Grated Cheese', es: 'Queso rallado' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['grated cheese', 'shredded cheese'],
      es: ['queso rallado', 'queso en polvo'],
    },
  },
  {
    slug: 'cheese-portions',
    name: { en: 'Cheese Portions', es: 'Queso en porciones' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['cheese portions', 'spreadable cheese'],
      es: ['queso en porciones', 'quesitos'],
    },
  },
  {
    slug: 'fresh-cheese',
    name: { en: 'Fresh Cheese', es: 'Queso fresco' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['fresh cheese', 'curd cheese'], es: ['queso fresco'] },
  },
  {
    slug: 'semi-cured-cheese',
    name: { en: 'Semi Cured Cheese', es: 'Queso semicurado' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['semi cured cheese', 'mixed cheese'],
      es: ['queso semicurado', 'queso mezcla'],
    },
  },
  {
    slug: 'cured-sheep-cheese',
    name: { en: 'Cured Sheep Cheese', es: 'Queso de oveja curado' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['sheep cheese', 'manchego'],
      es: ['queso de oveja', 'queso viejo'],
    },
  },
  {
    slug: 'cheese-spread',
    name: { en: 'Cheese and Ham Spread', es: 'Crema de queso y jamón' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['cheese spread', 'ham spread'],
      es: ['crema de queso', 'crema de jamón york'],
    },
  },
  {
    slug: 'eggs',
    name: { en: 'Eggs', es: 'Huevos' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['eggs', 'large eggs'], es: ['huevos', 'huevos clase l'] },
  },

  // --- Bakery --------------------------------------------------------------
  {
    slug: 'sliced-white-bread',
    name: { en: 'Sliced White Bread', es: 'Pan de molde blanco' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['sliced bread', 'white bread', 'sandwich bread'],
      es: ['pan de molde', 'pan blanco'],
    },
  },
  {
    slug: 'sliced-wholemeal-bread',
    name: { en: 'Sliced Wholemeal Bread', es: 'Pan de molde integral' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['wholemeal bread', 'whole wheat bread'],
      es: ['pan integral', 'pan de molde integral'],
    },
  },
  {
    slug: 'hot-dog-rolls',
    name: { en: 'Hot Dog Rolls', es: 'Pan de perrito' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['hot dog buns', 'hot dog rolls'],
      es: ['pan hot dog', 'pan de perrito'],
    },
  },
  {
    slug: 'bread-rolls',
    name: { en: 'Bread Rolls', es: 'Panecillos' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['bread rolls', 'buns'],
      es: ['panecillos', 'panadería', 'bollos'],
    },
  },
  {
    slug: 'breadsticks',
    name: { en: 'Breadsticks', es: 'Picos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['breadsticks', 'grissini'],
      es: ['picos', 'picos artesanos', 'regañás'],
    },
  },
  {
    slug: 'melba-toast',
    name: { en: 'Melba Toast', es: 'Biscotes' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['melba toast', 'toasted bread'],
      es: ['biscotes', 'mini biscotes', 'pan tostado'],
    },
  },
  {
    slug: 'filled-croissants',
    name: { en: 'Filled Croissants', es: 'Croissants rellenos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['croissant', 'filled croissant'],
      es: ['croissant relleno', 'croissant'],
    },
  },
  {
    slug: 'filled-buns',
    name: { en: 'Filled Buns', es: 'Bollos rellenos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    // Berlinas, pepitos, bocaditos and snack cakes: one group, because they are
    // interchangeable on a list and nobody minds which arrives.
    synonyms: {
      en: ['filled bun', 'doughnut', 'cream bun'],
      es: ['berlina', 'pepito', 'bollo relleno', 'bocadito'],
    },
  },
  {
    slug: 'sponge-cake',
    name: { en: 'Sponge Cake', es: 'Bizcocho' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['sponge cake', 'madeleine'],
      es: ['bizcocho', 'magdalenas'],
    },
  },
  {
    slug: 'traditional-pastries',
    name: { en: 'Traditional Pastries', es: 'Dulces tradicionales' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['pastries', 'coconut macaroon'],
      es: ['coquitos', 'cortadillos', 'dulces'],
    },
  },

  // --- Snacks and confectionery -------------------------------------------
  {
    slug: 'sunflower-seeds',
    name: { en: 'Sunflower Seeds', es: 'Pipas de girasol' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['sunflower seeds', 'pipas'],
      es: ['pipas', 'pipas de girasol', 'pipa gigante'],
    },
  },
  {
    slug: 'pistachios',
    name: { en: 'Pistachios', es: 'Pistachos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['pistachio', 'pistachios'],
      es: ['pistacho', 'pistachos'],
    },
  },
  {
    slug: 'chocolate-coated-peanuts',
    name: { en: 'Chocolate Coated Peanuts', es: 'Cacahuetes con chocolate' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['chocolate peanuts'],
      es: ['cacahuete chocolate', 'cacahuetes'],
    },
  },
  {
    slug: 'nut-mix',
    name: { en: 'Nut and Snack Mix', es: 'Cóctel de frutos secos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['nut mix', 'cocktail mix'],
      es: ['cóctel', 'cocktail', 'frutos secos'],
    },
  },
  {
    slug: 'crisps',
    name: { en: 'Crisps', es: 'Patatas fritas de bolsa' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['crisps', 'potato chips'],
      es: ['patatas fritas', 'patatas de bolsa'],
    },
  },
  {
    slug: 'potato-sticks',
    name: { en: 'Potato Sticks', es: 'Sticks de patata' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['potato sticks'], es: ['sticks de patata'] },
  },
  {
    slug: 'corn-snacks',
    name: { en: 'Corn Snacks', es: 'Aperitivos de maíz' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['corn snacks', 'cheese puffs', 'corn rolls'],
      es: ['garfitos', 'gusanitos', 'rollitos de maíz'],
    },
  },
  {
    slug: 'popcorn',
    name: { en: 'Popcorn', es: 'Palomitas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['popcorn', 'microwave popcorn'],
      es: ['palomitas', 'palomitas de maíz'],
    },
  },
  {
    slug: 'savoury-biscuits',
    name: { en: 'Savoury Biscuits', es: 'Galletas saladas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['savoury biscuits', 'crackers'],
      es: ['galletas saladas', 'cuquis'],
    },
  },
  {
    slug: 'chocolate-biscuits',
    name: { en: 'Chocolate Biscuits', es: 'Galletas de chocolate' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['chocolate biscuits', 'chocolate cookies'],
      es: ['galletas de chocolate', 'galletas rellenas'],
    },
  },
  {
    slug: 'plain-biscuits',
    name: { en: 'Plain Biscuits', es: 'Galletas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['biscuits', 'digestive', 'wholemeal biscuits'],
      es: ['galletas', 'galletas integrales', 'bocaditos'],
    },
  },
  {
    slug: 'white-chocolate',
    name: { en: 'White Chocolate', es: 'Chocolate blanco' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['white chocolate'],
      es: ['chocolate blanco', 'choco blanco'],
    },
  },
  {
    slug: 'milk-chocolate',
    name: { en: 'Milk Chocolate', es: 'Chocolate con leche' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['milk chocolate', 'chocolate bar'],
      es: ['chocolate con leche', 'chocolatina'],
    },
  },
  {
    slug: 'filled-chocolate',
    name: { en: 'Filled Chocolate Bar', es: 'Chocolate relleno' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['filled chocolate'],
      es: ['chocolate relleno', 'fussion'],
    },
  },
  {
    slug: 'cocoa-cereal-balls',
    name: { en: 'Cocoa Cereal Balls', es: 'Búlgaros de cacao' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['cocoa balls', 'cereal balls'],
      es: ['búlgaros', 'búlgaros al cacao'],
    },
  },
  {
    slug: 'boiled-sweets',
    name: { en: 'Boiled Sweets', es: 'Caramelos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['sweets', 'candy', 'boiled sweets'],
      es: ['caramelos', 'caramelo nata'],
    },
  },
  {
    slug: 'jelly-sweets',
    name: { en: 'Jelly Sweets', es: 'Gominolas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['jelly sweets', 'gummy sweets'],
      es: ['gominolas', 'chuches'],
    },
  },
  {
    slug: 'olives',
    name: { en: 'Olives', es: 'Aceitunas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['olives', 'stuffed olives'],
      es: ['aceitunas', 'aceituna rellena'],
    },
  },
  {
    slug: 'jam',
    name: { en: 'Jam', es: 'Mermelada' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['jam', 'marmalade', 'preserve'], es: ['mermelada'] },
  },

  // --- Frozen --------------------------------------------------------------
  {
    slug: 'ice-cream-cones',
    name: { en: 'Ice Cream Cones', es: 'Conos de helado' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['ice cream cone', 'cornetto'],
      es: ['cono de helado', 'cucurucho', 'miniconos'],
    },
  },
  {
    slug: 'ice-cream-tub',
    name: { en: 'Ice Cream Tub', es: 'Tarrina de helado' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['ice cream', 'ice cream tub'],
      es: ['helado', 'tarrina de helado'],
    },
  },
  {
    slug: 'ice-cream-bars',
    name: { en: 'Ice Cream Bars', es: 'Bombones helados' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['ice cream bar', 'choc ice'],
      es: ['bombón helado', 'bombón'],
    },
  },
  {
    slug: 'frozen-pizza',
    name: { en: 'Frozen Pizza', es: 'Pizza congelada' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['pizza', 'frozen pizza'],
      es: ['pizza', 'pizza congelada', 'masa fina'],
    },
  },
  {
    slug: 'frozen-green-beans',
    name: { en: 'Frozen Green Beans', es: 'Judías verdes congeladas' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['green beans', 'frozen beans'],
      es: ['judías verdes', 'judías'],
    },
  },

  // --- Pantry --------------------------------------------------------------
  {
    slug: 'mayonnaise',
    name: { en: 'Mayonnaise', es: 'Mayonesa' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: { en: ['mayonnaise', 'mayo'], es: ['mayonesa'] },
  },
  {
    slug: 'ketchup',
    name: { en: 'Ketchup', es: 'Ketchup' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: { en: ['ketchup', 'tomato sauce'], es: ['ketchup'] },
  },
  {
    slug: 'fried-tomato-sauce',
    name: { en: 'Fried Tomato Sauce', es: 'Tomate frito' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['fried tomato', 'tomato sauce'], es: ['tomate frito'] },
  },
  {
    slug: 'tinned-tomatoes',
    name: { en: 'Tinned Tomatoes', es: 'Tomate en conserva' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['tinned tomatoes', 'peeled tomatoes'],
      es: ['tomate entero', 'tomate pelado'],
    },
  },
  {
    slug: 'chickpeas',
    name: { en: 'Chickpeas', es: 'Garbanzos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['chickpeas', 'garbanzo beans'],
      es: ['garbanzos', 'garbanza'],
    },
  },
  {
    slug: 'paprika',
    name: { en: 'Paprika', es: 'Pimentón' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['paprika', 'sweet paprika'],
      es: ['pimentón', 'pimentón dulce'],
    },
  },
  {
    slug: 'table-salt',
    name: { en: 'Table Salt', es: 'Sal' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['salt', 'table salt', 'iodised salt'],
      es: ['sal', 'sal yodada'],
    },
  },
  {
    slug: 'brown-sugar',
    name: { en: 'Brown Sugar', es: 'Azúcar moreno' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['brown sugar', 'unrefined sugar'],
      es: ['azúcar moreno', 'azúcar'],
    },
  },
  {
    slug: 'plain-flour',
    name: { en: 'Plain Flour', es: 'Harina de trigo' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['flour', 'plain flour', 'wheat flour'],
      es: ['harina', 'harina de trigo'],
    },
  },
  {
    slug: 'frying-flour',
    name: { en: 'Frying Flour', es: 'Harina para freír' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['frying flour', 'batter mix'],
      es: ['harina para freír', 'harina de fritura'],
    },
  },
  {
    slug: 'noodles',
    name: { en: 'Soup Noodles', es: 'Fideos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['noodles', 'soup noodles', 'vermicelli'],
      es: ['fideos', 'fideos cabellín'],
    },
  },
  {
    slug: 'instant-noodles',
    name: { en: 'Instant Noodles', es: 'Fideos instantáneos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['instant noodles', 'yakisoba', 'pot noodle'],
      es: ['yatekomo', 'yakisoba', 'fideos instantáneos'],
    },
  },
  {
    slug: 'muesli',
    name: { en: 'Muesli', es: 'Muesli' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['muesli', 'granola', 'cereal'],
      es: ['muesli', 'cereales'],
    },
  },
  {
    slug: 'coffee-capsules',
    name: { en: 'Coffee Capsules', es: 'Cápsulas de café' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['coffee capsules', 'coffee pods'],
      es: ['cápsulas de café', 'café en cápsula'],
    },
  },
  {
    slug: 'instant-cappuccino',
    name: { en: 'Instant Cappuccino', es: 'Cappuccino soluble' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['instant cappuccino', 'instant coffee'],
      es: ['cappuccino', 'café soluble'],
    },
  },
  {
    slug: 'iced-coffee',
    name: { en: 'Iced Coffee', es: 'Café frío' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['iced coffee', 'ice coffee', 'milk coffee'],
      es: ['café con leche', 'ice coffee', 'café frío'],
    },
  },
  {
    slug: 'herbal-tea',
    name: { en: 'Herbal Tea', es: 'Infusiones' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['herbal tea', 'infusion'], es: ['infusión', 'tisana'] },
  },
  {
    slug: 'scrambled-egg-mix',
    name: { en: 'Scrambled Egg Mix', es: 'Revuelto preparado' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['scrambled egg mix'], es: ['revuelto', 'pasarratos'] },
  },
  // Nor a `nougat` group, for the same reason and a more surprising one: both
  // times a receipt says `TURRÓN` it is turrón ice cream, not turrón.

  // --- Drinks --------------------------------------------------------------
  {
    slug: 'still-water',
    name: { en: 'Still Water', es: 'Agua mineral' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['water', 'still water', 'mineral water'],
      es: ['agua', 'agua mineral'],
    },
  },
  {
    slug: 'lager',
    name: { en: 'Lager', es: 'Cerveza' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: { en: ['beer', 'lager'], es: ['cerveza', 'cerveza clásica'] },
  },
  {
    slug: 'alcohol-free-radler',
    name: { en: 'Alcohol Free Radler', es: 'Radler sin alcohol' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['radler', 'shandy', 'alcohol free beer'],
      es: ['radler', 'cerveza sin alcohol'],
    },
  },
  {
    slug: 'white-wine',
    name: { en: 'White Wine', es: 'Vino blanco' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: { en: ['white wine'], es: ['vino blanco'] },
  },
  {
    slug: 'fruit-and-milk-drink',
    name: { en: 'Fruit and Milk Drink', es: 'Bebida de frutas con leche' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['fruit milk drink', 'smoothie'],
      es: ['fruta + leche', 'frutas+leche', 'batido de frutas'],
    },
  },

  // --- Household -----------------------------------------------------------
  {
    slug: 'floor-cleaner',
    name: { en: 'Floor Cleaner', es: 'Friegasuelos' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['floor cleaner', 'floor soap'],
      es: ['friegasuelos', 'fregasuelos'],
    },
  },
  {
    slug: 'insecticide-floor-cleaner',
    name: { en: 'Insecticide Floor Cleaner', es: 'Friegasuelos insecticida' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['insecticide floor cleaner'],
      es: ['friegasuelos insecticida'],
    },
  },
  {
    slug: 'bleach',
    name: { en: 'Bleach', es: 'Lejía' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: { en: ['bleach'], es: ['lejía'] },
  },
  {
    slug: 'toilet-cleaner',
    name: { en: 'Toilet Cleaner', es: 'Limpiador de WC' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['toilet cleaner', 'toilet gel'],
      es: ['limpiador wc', 'gel wc'],
    },
  },
  {
    slug: 'toilet-rim-block',
    name: { en: 'Toilet Rim Block', es: 'Colgador de WC' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['rim block', 'toilet block'],
      es: ['colgador wc', 'colgador'],
    },
  },
  {
    slug: 'furniture-polish',
    name: { en: 'Furniture Polish', es: 'Limpiamuebles' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: { en: ['furniture polish'], es: ['limpiamuebles'] },
  },
  {
    slug: 'stain-remover',
    name: { en: 'Stain Remover', es: 'Quitamanchas' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['stain remover'],
      es: ['quitamanchas', 'disuelvemanchas'],
    },
  },
  {
    slug: 'fabric-softener',
    name: { en: 'Fabric Softener', es: 'Suavizante' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['fabric softener', 'fabric conditioner'],
      es: ['suavizante'],
    },
  },
  {
    slug: 'laundry-scent-beads',
    name: { en: 'Laundry Scent Beads', es: 'Perlas de perfume para la ropa' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['scent beads', 'unstoppables'],
      es: ['perlas de perfume', 'perlas para la ropa'],
    },
  },
  {
    slug: 'pet-hair-remover',
    name: { en: 'Pet Hair Remover', es: 'Quitapelos de mascotas' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['pet hair remover', 'lint remover'], es: ['quitapelos'] },
  },
  {
    slug: 'air-freshener',
    name: { en: 'Air Freshener', es: 'Ambientador' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['air freshener'], es: ['ambientador'] },
  },
  {
    slug: 'odour-eliminator',
    name: { en: 'Odour Eliminator', es: 'Eliminador de olores' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['odour eliminator', 'odor eliminator'],
      es: ['eliminador de olores'],
    },
  },
  {
    slug: 'mosquito-repellent-refill',
    name: { en: 'Mosquito Repellent Refill', es: 'Recambio antimosquitos' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['mosquito repellent', 'insect repellent'],
      es: ['antimosquitos', 'recambio antimosquitos'],
    },
  },
  {
    slug: 'bin-bags',
    name: { en: 'Bin Bags', es: 'Bolsas de basura' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['bin bags', 'rubbish bags', 'garbage bags'],
      es: ['bolsas de basura', 'basura'],
    },
  },
  {
    slug: 'compostable-bin-bags',
    name: { en: 'Compostable Bin Bags', es: 'Bolsas de basura compostables' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['compostable bags', 'compost bags'],
      es: ['bolsas compostables', 'basura compost'],
    },
  },
  {
    slug: 'dog-waste-bags',
    name: { en: 'Dog Waste Bags', es: 'Bolsas para excrementos' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['dog waste bags', 'doggy bags'],
      es: ['bolsas para perro', 'doggybag'],
    },
  },
  {
    slug: 'carrier-bag',
    name: { en: 'Carrier Bag', es: 'Bolsa de la compra' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['carrier bag', 'shopping bag'],
      es: ['bolsa', 'bolsa de la compra'],
    },
  },
  {
    slug: 'cleaning-cloths',
    name: { en: 'Cleaning Cloths', es: 'Bayetas' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['cleaning cloth', 'microfibre cloth'],
      es: ['bayeta', 'bayetas'],
    },
  },
  {
    slug: 'mop-head',
    name: { en: 'Mop Head', es: 'Fregona' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['mop', 'mop head'], es: ['fregona'] },
  },
  {
    slug: 'mop-bucket',
    name: { en: 'Mop Bucket', es: 'Cubo de fregar' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['bucket', 'mop bucket'], es: ['cubo', 'cubo de fregar'] },
  },
  {
    slug: 'toilet-paper',
    name: { en: 'Toilet Paper', es: 'Papel higiénico' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['toilet paper', 'toilet roll'], es: ['papel higiénico'] },
  },
  {
    slug: 'kitchen-roll',
    name: { en: 'Kitchen Roll', es: 'Papel de cocina' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['kitchen roll', 'paper towels'],
      es: ['papel de cocina', 'rollo de hogar'],
    },
  },
  {
    slug: 'paper-napkins',
    name: { en: 'Paper Napkins', es: 'Servilletas' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['napkins', 'serviettes'], es: ['servilletas'] },
  },
  {
    slug: 'baking-paper',
    name: { en: 'Baking Paper', es: 'Papel vegetal' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['baking paper', 'greaseproof paper', 'parchment'],
      es: ['papel vegetal', 'papel de horno'],
    },
  },
  {
    slug: 'aluminium-foil',
    name: { en: 'Aluminium Foil', es: 'Papel de aluminio' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['foil', 'aluminium foil', 'tin foil'],
      es: ['papel de aluminio', 'papel albal'],
    },
  },
  {
    slug: 'food-storage-tubs',
    name: { en: 'Food Storage Tubs', es: 'Botes para comida' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['storage tub', 'food container'],
      es: ['bote', 'táper', 'recipiente'],
    },
  },

  // --- Personal care -------------------------------------------------------
  {
    slug: 'shampoo',
    name: { en: 'Shampoo', es: 'Champú' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: { en: ['shampoo'], es: ['champú'] },
  },
  {
    slug: 'hair-mask',
    name: { en: 'Hair Mask', es: 'Mascarilla capilar' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['hair mask', 'conditioner'],
      es: ['mascarilla capilar', 'acondicionador'],
    },
  },
  {
    slug: 'shower-gel',
    name: { en: 'Shower Gel', es: 'Gel de baño' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['shower gel', 'body wash'],
      es: ['gel de baño', 'gel de ducha'],
    },
  },
  {
    slug: 'hand-soap',
    name: { en: 'Hand Soap', es: 'Jabón de manos' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: { en: ['hand soap', 'hand wash'], es: ['jabón de manos'] },
  },
  {
    slug: 'deodorant',
    name: { en: 'Deodorant', es: 'Desodorante' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['deodorant', 'antiperspirant'],
      es: ['desodorante', 'deo'],
    },
  },
  {
    slug: 'shoe-deodorant',
    name: { en: 'Shoe Deodorant', es: 'Desodorante para calzado' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['shoe deodorant', 'shoe spray'],
      es: ['desodorante calzado'],
    },
  },
  {
    slug: 'eau-de-parfum',
    name: { en: 'Eau de Parfum', es: 'Eau de parfum' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['perfume', 'eau de parfum', 'cologne'],
      es: ['perfume', 'colonia', 'edp'],
    },
  },
  {
    slug: 'antiseptic-spray',
    name: { en: 'Antiseptic Spray', es: 'Spray antiséptico' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['antiseptic', 'disinfectant spray'],
      es: ['antiséptico', 'spray desinfectante'],
    },
  },
  {
    slug: 'cotton-pads',
    name: { en: 'Cotton Pads', es: 'Discos desmaquillantes' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['cotton pads', 'makeup remover pads'],
      es: ['discos desmaquillantes', 'algodón'],
    },
  },
  {
    slug: 'panty-liners',
    name: { en: 'Panty Liners', es: 'Protegeslips' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['panty liners', 'liners'],
      es: ['protegeslip', 'salvaslip'],
    },
  },
  {
    slug: 'baby-wipes',
    name: { en: 'Baby Wipes', es: 'Toallitas de bebé' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['baby wipes', 'wipes'],
      es: ['toallitas', 'toallitas bebé'],
    },
  },
  {
    slug: 'moist-toilet-tissue',
    name: { en: 'Moist Toilet Tissue', es: 'Papel higiénico húmedo' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['moist toilet tissue', 'wet wipes'],
      es: ['papel húmedo', 'papel higiénico húmedo'],
    },
  },
  {
    slug: 'nail-polish',
    name: { en: 'Nail Polish', es: 'Laca de uñas' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['nail polish', 'nail varnish'],
      es: ['laca de uñas', 'esmalte'],
    },
  },
  {
    slug: 'nail-top-coat',
    name: { en: 'Nail Top Coat', es: 'Top coat de uñas' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: {
      en: ['top coat', 'nail treatment'],
      es: ['top coat', 'laca gel brillo'],
    },
  },
  {
    slug: 'nail-polish-remover',
    name: { en: 'Nail Polish Remover', es: 'Quitaesmalte' },
    referenceUnit: UnitOfMeasure.LITER,
    synonyms: { en: ['nail polish remover', 'acetone'], es: ['quitaesmalte'] },
  },
  {
    slug: 'mascara',
    name: { en: 'Mascara', es: 'Máscara de pestañas' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['mascara'], es: ['máscara de pestañas', 'rímel'] },
  },
  {
    slug: 'blusher',
    name: { en: 'Blusher', es: 'Colorete' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['blusher', 'blush'], es: ['colorete', 'blush'] },
  },
  {
    slug: 'lip-liner',
    name: { en: 'Lip Liner', es: 'Perfilador de labios' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: { en: ['lip liner', 'lip pencil'], es: ['perfilador de labios'] },
  },
  {
    slug: 'hair-tie',
    name: { en: 'Hair Tie', es: 'Coletero' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['hair tie', 'scrunchie', 'hair band'],
      es: ['coletero', 'goma del pelo'],
    },
  },

  // --- Pet ----------------------------------------------------------------
  {
    slug: 'wet-dog-food',
    name: { en: 'Wet Dog Food', es: 'Comida húmeda para perro' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['dog food', 'wet dog food'],
      es: ['comida perro', 'tarrina perro'],
    },
  },
  {
    slug: 'dry-dog-food',
    name: { en: 'Dry Dog Food', es: 'Pienso para perro' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['dry dog food', 'dog kibble'],
      es: ['pienso perro', 'comida seca perro'],
    },
  },
  {
    slug: 'dog-treats',
    name: { en: 'Dog Treats', es: 'Snacks para perro' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: {
      en: ['dog treats', 'dog snacks', 'dog chews'],
      es: ['snack perro', 'premios perro', 'salchicha perro'],
    },
  },
  {
    slug: 'wet-cat-food',
    name: { en: 'Wet Cat Food', es: 'Comida húmeda para gato' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['cat food', 'wet cat food'], es: ['comida gato'] },
  },
  {
    slug: 'cat-litter',
    name: { en: 'Cat Litter', es: 'Arena para gatos' },
    referenceUnit: UnitOfMeasure.KILOGRAM,
    synonyms: { en: ['cat litter'], es: ['arena de gatos', 'arena para gato'] },
  },

  // --- Stationery ----------------------------------------------------------
  {
    slug: 'whiteboard-markers',
    name: { en: 'Whiteboard Markers', es: 'Rotuladores de pizarra' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['whiteboard marker', 'dry wipe marker'],
      es: ['rotulador de pizarra', 'rotulador'],
    },
  },
  {
    slug: 'ring-binder',
    name: { en: 'Ring Binder', es: 'Carpeta de anillas' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['ring binder', 'folder'],
      es: ['carpeta', 'carpeta de anillas'],
    },
  },
  {
    slug: 'binder-paper',
    name: { en: 'Binder Paper', es: 'Recambio de folios' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['binder paper', 'refill pad', 'loose leaf'],
      es: ['recambio', 'recambio de anillas'],
    },
  },
  {
    slug: 'punched-pockets',
    name: { en: 'Punched Pockets', es: 'Fundas multitaladro' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['punched pockets', 'plastic wallets'],
      es: ['fundas', 'fundas multitaladro'],
    },
  },
  {
    slug: 'adhesive-tape',
    name: { en: 'Adhesive Tape', es: 'Cinta adhesiva' },
    referenceUnit: UnitOfMeasure.UNIT,
    synonyms: {
      en: ['tape', 'sellotape', 'adhesive tape'],
      es: ['cinta adhesiva', 'celo'],
    },
  },
];
