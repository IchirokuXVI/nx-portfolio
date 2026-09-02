import type { HarvestedAssignment } from './types';

/**
 * The Mercadona half of the reference catalog (plan 0067, section 3).
 *
 * 109 products, every one of them bought on one of the four Córdoba receipts and
 * matched to a row the harvest already carries. The seed does not create these
 * items and does not price them: it sets `productGroupId`, which is the one
 * thing a harvest run cannot work out for itself.
 *
 * **The prices are deliberately not written.** A harvested Mercadona row already
 * carries an `OFFICIAL_WEB` price that is fresher than a receipt from August,
 * and `supermarket_items` holds exactly one row per item per scope, so writing
 * the receipt price would not add a second observation, it would destroy the
 * better one. Receipt prices are for the products nothing else prices: El Jamón,
 * SuperCash, and the eight Mercadona products in `authored.ts` that the harvest
 * does not carry.
 *
 * How the matching was done, because it cannot be re-derived by reading this
 * file: each till abbreviation was scored against all 4,196 harvested names by
 * token overlap, and the receipt's own price had to agree with the harvested one
 * before a match was accepted. 100 of the 109 agree to the cent. The nine that
 * do not are the weighed products, where the receipt's figure is per kilogram
 * and the catalog's `price` is for one fish, so the comparison is against
 * `unitPrice` instead and agrees there.
 */
export const MERCADONA_ASSIGNMENTS: HarvestedAssignment[] = [
  {
    ean: '8480000228253',
    group: 'cleaning-cloths',
    receipt: 'BAYETA MICROFIBRA CR',
  },
  {
    ean: '8480000227744',
    group: 'cleaning-cloths',
    receipt: 'LOTE 3 BAYETAS PEQ.',
  },
  { ean: '8402001001314', group: 'olives', receipt: 'ACEITUNA R/ANCHOA P3' },
  { ean: '8411547001085', group: 'still-water', receipt: 'AGUA MINERAL' },
  { ean: '7613287415691', group: 'still-water', receipt: 'F. DEHESA 500ML' },
  { ean: '8412239000973', group: 'cat-litter', receipt: 'ARENA DE GATOS' },
  { ean: '2105433038243', group: 'bananas', receipt: 'BANANA' },
  { ean: '2105499693264', group: 'aubergines', receipt: 'BERENJENA' },
  { ean: '8402001057786', group: 'filled-buns', receipt: 'BERLINA AZUCAR' },
  {
    ean: '8402001032875',
    group: 'compostable-bin-bags',
    receipt: '20 B. BASURA COMPOST',
  },
  { ean: '8402001032844', group: 'bin-bags', receipt: '30 B.BASURA EXTRA' },
  { ean: '8480000497031', group: 'bin-bags', receipt: '10 S.JARDÍN C. FÁCIL' },
  {
    ean: '5060079620580',
    group: 'dog-waste-bags',
    receipt: '45 BOLSAS DOGGYBAG',
  },
  // One harvested row for both grades the counter sells; the receipt's own two
  // prices are what tell them apart, and the catalog has no second row to hold
  // the other one.
  {
    ean: '2105300816615',
    group: 'fresh-anchovies',
    receipt: 'BOQUERÓN MED 51/80',
    alsoReceipt: ['BOQUERÓN PEQ 81/120'],
  },
  {
    ean: '8480000123473',
    group: 'chocolate-coated-peanuts',
    receipt: 'CACAHUETE CHOCOLATE',
  },
  {
    ean: '8402001038372',
    group: 'iced-coffee',
    receipt: 'CAFÉ LECHE CAPPUCCIN',
  },
  {
    ean: '8402001049651',
    group: 'coffee-capsules',
    receipt: 'CÁP. EXTRAFORTE',
  },
  {
    ean: '8480000676603',
    group: 'instant-cappuccino',
    receipt: 'CAPPUCCINO CARAMELO',
  },
  {
    ean: '3215690801906',
    group: 'boiled-sweets',
    receipt: 'CARAMELO NATA S/AZUC',
  },
  { ean: '8480000664624', group: 'lager', receipt: 'CERVEZA CLASICA LATA' },
  {
    ean: '8411090310559',
    group: 'alcohol-free-radler',
    receipt: "RADLER 0'0 PACK 8",
  },
  { ean: '8480000443373', group: 'shampoo', receipt: 'CHAMPU ARGAN OIL' },
  {
    ean: '8402001026263',
    group: 'filled-chocolate',
    receipt: 'FUSSION RODITAS',
  },
  { ean: '8480000124760', group: 'white-chocolate', receipt: 'CHOCO BLANCO' },
  { ean: '8402001055416', group: 'nut-mix', receipt: 'COCKTAIL TWIST UP' },
  {
    ean: '8402001050879',
    group: 'toilet-rim-block',
    receipt: 'COLGADOR WC GLOW',
  },
  { ean: '8480000803955', group: 'blusher', receipt: 'BLUSH MATE 3' },
  {
    ean: '8402001030642',
    group: 'dry-dog-food',
    receipt: 'C.TERNERA/POLLO/VERD',
  },
  { ean: '2105300810552', group: 'meagre', receipt: 'CORVINA' },
  {
    ean: '8402001018817',
    group: 'filled-croissants',
    receipt: 'CROISSANT RELL CACAO',
  },
  {
    ean: '8402001011672',
    group: 'mop-bucket',
    receipt: 'CUBO FREGAR C/RUEDAS',
  },
  { ean: '8480000335814', group: 'savoury-biscuits', receipt: 'CUQUIS' },
  { ean: '8720181072130', group: 'deodorant', receipt: 'DEO AXE DARK TEMPT.' },
  { ean: '8402001015656', group: 'deodorant', receipt: 'DEO ROLL-ON AVENA' },
  {
    ean: '8480000794079',
    group: 'cotton-pads',
    receipt: 'DISCOS DESM REDONDO',
  },
  { ean: '8480000401786', group: 'stain-remover', receipt: 'DISUELVEMANCHAS' },
  { ean: '2105318812340', group: 'sea-bream', receipt: 'DORADA' },
  { ean: '8402001009341', group: 'eau-de-parfum', receipt: 'EDP REBEL' },
  {
    ean: '8480000405524',
    group: 'odour-eliminator',
    receipt: 'ELIMINADOR OLORES',
  },
  { ean: '8480000676337', group: 'creme-caramel', receipt: 'FLAN DE CAFÉ' },
  {
    ean: '8402001020926',
    group: 'floor-cleaner',
    receipt: 'FRIEGASUELOS FLORAL',
  },
  {
    ean: '8402001060007',
    group: 'insecticide-floor-cleaner',
    receipt: 'FRIEG.INSECTICIDA',
  },
  {
    ean: '8402001028847',
    group: 'fruit-and-milk-drink',
    receipt: 'F. LECHE PIÑA COCO',
  },
  {
    ean: '8402001024887',
    group: 'fruit-and-milk-drink',
    receipt: 'F.LECHE TROPICAL',
  },
  { ean: '8480000551085', group: 'fuet', receipt: 'FUET ESPETEC EXTRA' },
  {
    ean: '8480000138897',
    group: 'corn-snacks',
    receipt: 'GARFITOS SABOR QUESO',
  },
  { ean: '8402001045264', group: 'ice-cream-bars', receipt: 'BOMBÓN PISTACHO' },
  {
    ean: '8480000642301',
    group: 'ice-cream-cones',
    receipt: 'CROCAN CHOC VAINILLA',
  },
  { ean: '8480000642516', group: 'ice-cream-cones', receipt: 'CONO NATA' },
  { ean: '8480000644459', group: 'ice-cream-tub', receipt: 'TURRÓN' },
  { ean: '8402001047299', group: 'ice-cream-tub', receipt: 'GOLDEN PECAN' },
  {
    ean: '8480000104731',
    group: 'lactose-free-milk',
    receipt: 'LECHE SEMI S/LACT',
  },
  { ean: '8480000430540', group: 'bleach', receipt: 'LEJIA DETERG.LIMON' },
  {
    ean: '8402001007736',
    group: 'furniture-polish',
    receipt: 'LIMPIAMUEBLES C/CERA',
  },
  {
    ean: '8402001041402',
    group: 'toilet-cleaner',
    receipt: 'GEL WC PERFUMADO',
  },
  { ean: '8402001040665', group: 'mascara', receipt: 'MÁSCARA LONG XTREM' },
  { ean: '8402001043550', group: 'mayonnaise', receipt: 'MAYONESA 500ML' },
  { ean: '8480000866844', group: 'jam', receipt: 'MERM. MELOCOTÓN' },
  {
    ean: '5601560111882',
    group: 'melba-toast',
    receipt: 'MINI BISCOTTE NORMAL',
  },
  { ean: '8421384016210', group: 'diced-ham', receipt: 'MINI TAQUITOS JAMON' },
  {
    ean: '8480000683502',
    group: 'chocolate-mousse',
    receipt: 'MOUSSE CHOCO P-4',
  },
  { ean: '8480000094926', group: 'muesli', receipt: 'MUESLI CON FRUTAS' },
  {
    ean: '8480000223111',
    group: 'protein-dessert',
    receipt: '+PROT NATILLA VAINI',
  },
  { ean: '8410063089096', group: 'surimi-sticks', receipt: 'PALITOS SURIMI' },
  { ean: '8480000342126', group: 'popcorn', receipt: 'PALOMIT. MANTEQUILLA' },
  {
    ean: '8480000838674',
    group: 'sliced-white-bread',
    receipt: 'PAN BLANCO FAMILIAR',
  },
  { ean: '8480000823328', group: 'hot-dog-rolls', receipt: 'PAN HOT DOG' },
  { ean: '8480000681881', group: 'panna-cotta', receipt: 'PANNA COTTA' },
  {
    ean: '8480000472915',
    group: 'moist-toilet-tissue',
    receipt: 'PAPEL HUMEDO WC',
  },
  {
    ean: '8402001032837',
    group: 'toilet-paper',
    receipt: 'PAPEL HIGIÉNICO 4 CA',
  },
  { ean: '8480000496195', group: 'kitchen-roll', receipt: 'ROLLO HOGAR DOBLE' },
  { ean: '8480000236081', group: 'baking-paper', receipt: 'PAPEL VEGETAL 30H' },
  {
    ean: '8480000610348',
    group: 'grilled-vegetables',
    receipt: 'PARRILLADA VERDURA A',
  },
  { ean: '8480000223500', group: 'lip-liner', receipt: 'PERF.LABIOS 06' },
  { ean: '8402001018756', group: 'paprika', receipt: 'PIMENTÓN DULCE LATA' },
  {
    ean: '8480000340788',
    group: 'sunflower-seeds',
    receipt: 'PIPA GIGANTE AGUASAL',
  },
  {
    ean: '8480000861900',
    group: 'pistachios',
    receipt: 'PISTACHO TOSTADO SAL',
  },
  { ean: '8480000635013', group: 'frozen-pizza', receipt: 'PIZZA DE ATUN' },
  { ean: '8480000226495', group: 'frozen-pizza', receipt: 'PIZZA BBQ M.FINA' },
  {
    ean: '8480000633392',
    group: 'frozen-pizza',
    receipt: 'PIZZA JAMON M.FINA',
  },
  {
    ean: '8480000473509',
    group: 'panty-liners',
    receipt: 'PROTEG. COTTON MAXI',
  },
  { ean: '8480000473523', group: 'panty-liners', receipt: 'PROT. DRY MAXI' },
  {
    ean: '8422241807378',
    group: 'grated-cheese',
    receipt: 'QUESO RALLADO POLVO',
  },
  {
    ean: '8480000524058',
    group: 'cheese-portions',
    receipt: 'PORCIÓN REGULAR',
  },
  { ean: '8480000511829', group: 'sliced-cheese', receipt: 'LONCHAS DE QUESO' },
  { ean: '8480000236227', group: 'grated-cheese', receipt: 'Q RALLADO FUNDIR' },
  {
    ean: '8480000796318',
    group: 'nail-polish-remover',
    receipt: 'QUITAESMALTE C/ACET',
  },
  { ean: '8480000229052', group: 'hand-soap', receipt: 'REFILL DERMO' },
  { ean: '8410843011866', group: 'salami', receipt: 'SALAMI MONTAÑES' },
  { ean: '8480000520968', group: 'dog-treats', receipt: 'SALCH.POLLO Y ARROZ' },
  {
    ean: '8480000531438',
    group: 'cooked-sausages',
    receipt: 'SALCHICHAS GOURMET',
  },
  {
    ean: '8480000531414',
    group: 'frankfurter-sausages',
    receipt: 'PACK-4 SALCH.FRANKF',
  },
  {
    ean: '8480000182258',
    group: 'tinned-sardines',
    receipt: 'SARDINAS OLIVA BIPAC',
  },
  {
    ean: '8480000182098',
    group: 'tinned-small-sardines',
    receipt: 'SARDINILLAS TOMATE',
  },
  {
    ean: '8480000182142',
    group: 'tinned-small-sardines',
    receipt: 'SARDINILLA RE. SAL O',
  },
  {
    ean: '8480000495891',
    group: 'paper-napkins',
    receipt: 'SERVILLETA 2 CAPAS',
  },
  {
    ean: '8480000794383',
    group: 'antiseptic-spray',
    receipt: 'SPRAY ANTI SEPTIC',
  },
  { ean: '8480000225689', group: 'potato-sticks', receipt: 'STICKS DE PATATA' },
  {
    ean: '8402001027529',
    group: 'fabric-softener',
    receipt: 'SUAVI-HIPOALERGÉNICO',
  },
  { ean: '8402001026027', group: 'baby-wipes', receipt: 'TOALL.BEBE FRESC.80' },
  {
    ean: '8480000171320',
    group: 'fried-tomato-sauce',
    receipt: 'TOMATE FRITO BRICK',
  },
  { ean: '8402001052248', group: 'pork-crackling', receipt: 'TORREZNILLOS' },
  { ean: '8402001038785', group: 'pork-crackling', receipt: 'TORREZNO MORRO' },
  { ean: '8480000422866', group: 'nail-top-coat', receipt: 'LACA GEL BRILLO' },
  { ean: '2105361812007', group: 'rainbow-trout', receipt: 'TRUCHA ARCO IRIS' },
  { ean: '8480000661272', group: 'white-wine', receipt: 'VINO BLANCO BRICK' },
  { ean: '8480000284969', group: 'childrens-yogurt', receipt: 'YOGOMIX X6' },
  { ean: '8480000226518', group: 'greek-yogurt', receipt: 'GRIEGO LIMÓN' },
];
