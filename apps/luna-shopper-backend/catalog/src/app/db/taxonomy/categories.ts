import { categoryId } from './ids';
import type { ReferenceCategoryRoot } from './types';

/**
 * The taxonomy: thirty three roots and two hundred and seventy six leaves, and
 * a product only ever on a leaf. Twenty nine roots and two hundred and forty
 * six leaves are plan 0173's appendix A, and four roots and thirty leaves are
 * plan 0179's, for what DIA does not sell.
 *
 * It is DIA's own menu tree, read once on 2026-09-29 and copied as ours, in
 * DIA's order and with DIA's names in both languages, without its seasonal,
 * offer and campaign categories. Three rows are ours: the leaf `other-fruits`,
 * and the root `other` with its leaf `uncategorised`. It replaced the hand
 * written tree of plan 0166. It is a copy and not a mirror: it does not follow
 * DIA afterwards, and it is edited in the back office like any other tree.
 *
 * The English names are DIA's, several of them machine translation ("Cuts and
 * cuts", "Ron and whisky", "Cakes" for both Tartas and Tortitas). They are kept
 * as served on purpose (section 9). Correcting one is the owner's call.
 *
 * The rows marked `ours, plan 0179` are not DIA's. Mercadona, Deza and El
 * Jamón sell make-up, books, stationery, home textiles, toys and more, and
 * DIA's tree had no leaf for any of it. The migration `CategoriesBeyondDia`
 * added them: eight leaves at the end of roots DIA has, and four roots placed
 * before `other`, which stays the last root.
 *
 * The comment beside each row is DIA's id for that node. It is not data: the
 * table has no column for it and the id means nothing to the catalog.
 *
 * `seedTaxonomy` upserts every row here by the id its slug derives, names and
 * positions included, and never deletes. Only the demo seed calls it, so in a
 * cluster the tree is what the migration wrote and what the back office has
 * made of it since.
 *
 * **A slug is an identity and never changes once shipped.** The id is derived
 * from it, the migrations `DiaCategoryTree` and `CategoriesBeyondDia` wrote
 * every row here under those same ids, and the demo world and the harvest resolvers all name a category
 * by slug. Rename the `name`, never the `slug`.
 *
 * There are no catch all leaves. A product that fits no leaf goes on
 * `uncategorised`, which is also where the harvester files a product it cannot
 * place.
 */
export const REFERENCE_CATEGORIES: ReferenceCategoryRoot[] = [
  {
    slug: 'fruits', // L105
    name: { en: 'Fruits', es: 'Frutas' },
    children: [
      {
        slug: 'bananas-and-plantains', // L2033
        name: { en: 'Bananas and plantains', es: 'Plátanos y bananas' },
      },
      {
        slug: 'apples-and-pears', // L2032
        name: { en: 'Apples and pears', es: 'Manzanas y peras' },
      },
      {
        slug: 'oranges-tangerines-and-lemons', // L2196
        name: {
          en: 'Oranges, tangerines, and lemons',
          es: 'Naranjas, mandarinas y limones',
        },
      },
      {
        slug: 'melon-and-watermelon', // L2267
        name: { en: 'Melon and watermelon', es: 'Melón y sandía' },
      },
      {
        slug: 'grapes', // L2035
        name: { en: 'Grapes', es: 'Uvas' },
      },
      {
        slug: 'tropical-fruits', // L2039
        name: { en: 'Tropical fruits', es: 'Frutas tropicales' },
      },
      {
        slug: 'red-and-forest-fruits', // L2038
        name: { en: 'Red and forest fruits', es: 'Frutos rojos y del bosque' },
      },
      {
        slug: 'frozen-fruits', // L2268
        name: { en: 'Frozen fruits', es: 'Frutas congeladas' },
      },
      {
        slug: 'other-fruits', // ours, no DIA id
        name: { en: 'Other fruits', es: 'Otras frutas' },
      },
    ],
  },
  {
    slug: 'vegetables', // L104
    name: { en: 'Vegetables', es: 'Verduras' },
    children: [
      {
        slug: 'lettuce-and-leafy-greens', // L2027
        name: { en: 'Lettuce and leafy greens', es: 'Lechugas y hojas verdes' },
      },
      {
        slug: 'tomatoes-peppers-and-cucumbers', // L2023
        name: {
          en: 'Tomatoes, peppers and cucumbers',
          es: 'Tomates, pimientos y pepinos',
        },
      },
      {
        slug: 'garlic-onions-and-leeks', // L2022
        name: {
          en: 'Garlic, onions and leeks',
          es: 'Ajos, cebollas y puerros',
        },
      },
      {
        slug: 'courgette-pumpkin-and-aubergine', // L2181
        name: {
          en: 'Courgette, pumpkin and aubergine',
          es: 'Calabacín, calabaza y berenjena',
        },
      },
      {
        slug: 'potatoes-and-carrots', // L2028
        name: { en: 'Potatoes and carrots', es: 'Patatas y zanahorias' },
      },
      {
        slug: 'broccoli-cauliflower-and-green-beans', // L2024
        name: {
          en: 'Broccoli, cauliflower, and green beans',
          es: 'Brócoli, coliflor y judías verdes',
        },
      },
      {
        slug: 'mushrooms', // L2029
        name: { en: 'Mushrooms', es: 'Setas y champiñones' },
      },
      {
        slug: 'aromatic-herbs', // L2031
        name: { en: 'Aromatic herbs', es: 'Hierbas aromáticas' },
      },
      {
        slug: 'salads-and-prepared-vegetables', // L2030
        name: {
          en: 'Salads and prepared vegetables',
          es: 'Ensaladas y verduras preparadas',
        },
      },
      {
        slug: 'frozen-and-steamed-vegetables', // L2025
        name: {
          en: 'Frozen and steamed vegetables',
          es: 'Verduras congeladas y al vapor',
        },
      },
      {
        slug: 'vegetables-canned-vegetables', // L2026
        name: { en: 'Canned vegetables', es: 'Conservas de verduras' },
      },
    ],
  },
  {
    slug: 'meats', // L102
    name: { en: 'Meats', es: 'Carnes' },
    children: [
      {
        slug: 'chicken', // L2202
        name: { en: 'Chicken', es: 'Pollo' },
      },
      {
        slug: 'beef', // L2013
        name: { en: 'Beef', es: 'Vacuno' },
      },
      {
        slug: 'pork', // L2014
        name: { en: 'Pork', es: 'Cerdo' },
      },
      {
        slug: 'turkey', // L2015
        name: { en: 'Turkey', es: 'Pavo' },
      },
      {
        slug: 'rabbit', // L2016
        name: { en: 'Rabbit', es: 'Conejo' },
      },
      {
        slug: 'hamburgers-ground-beef-and-meatballs', // L2017
        name: {
          en: 'Hamburgers, ground beef, and meatballs',
          es: 'Hamburguesas, carne picada y albóndigas',
        },
      },
      {
        slug: 'breaded-and-prepared-foods', // L2265
        name: {
          en: 'Breaded and prepared foods',
          es: 'Empanados y elaborados',
        },
      },
      {
        slug: 'cuts-and-cuts', // L2266
        name: { en: 'Cuts and cuts', es: 'Arreglos y despieces' },
      },
    ],
  },
  {
    slug: 'fish-and-seafood', // L103
    name: { en: 'Fish and seafood', es: 'Pescados y mariscos' },
    children: [
      {
        slug: 'fish-and-seafood-fresh', // L2019
        name: { en: 'Fresh', es: 'Fresco' },
      },
      {
        slug: 'fish-and-seafood-frozen', // L2249
        name: { en: 'Frozen', es: 'Congelado' },
      },
      {
        slug: 'breaded', // L2251
        name: { en: 'Breaded', es: 'Rebozado' },
      },
      {
        slug: 'seafood-shrimp-and-squid', // L2253
        name: {
          en: 'Seafood, shrimp and squid',
          es: 'Marisco, gamba y calamar',
        },
      },
      {
        slug: 'smoked-and-salted', // L2020
        name: { en: 'Smoked and salted', es: 'Ahumado y salazón' },
      },
      {
        slug: 'surimi-and-prepared-products', // L2021
        name: { en: 'Surimi and prepared products', es: 'Surimi y elaborados' },
      },
    ],
  },
  {
    slug: 'charcuterie', // L134
    name: { en: 'Charcuterie', es: 'Charcutería' },
    children: [
      {
        slug: 'cooked-ham', // L2001
        name: { en: 'Cooked ham', es: 'Jamón cocido' },
      },
      {
        slug: 'turkey-and-chicken', // L2342
        name: { en: 'Turkey and chicken', es: 'Pavo y pollo' },
      },
      {
        slug: 'serrano-ham', // L2004
        name: { en: 'Serrano ham', es: 'Jamón serrano' },
      },
      {
        slug: 'loin-and-chorizo', // L2005
        name: { en: 'Loin and chorizo', es: 'Lomo y chorizo' },
      },
      {
        slug: 'fuet-and-salchichon', // L2343
        name: { en: 'Fuet and salchichón', es: 'Fuet y salchichón' },
      },
      {
        slug: 'chopped-and-mortadella', // L2259
        name: { en: 'Chopped and mortadella', es: 'Chopped y mortadela' },
      },
      {
        slug: 'sausages', // L2206
        name: { en: 'Sausages', es: 'Salchichas' },
      },
      {
        slug: 'bacon', // L2344
        name: { en: 'Bacon', es: 'Bacon' },
      },
      {
        slug: 'pate-and-sobrasada', // L2012
        name: { en: 'Pâté and sobrasada', es: 'Paté y sobrasada' },
      },
    ],
  },
  {
    slug: 'cheeses', // L101
    name: { en: 'Cheeses', es: 'Quesos' },
    children: [
      {
        slug: 'cured', // L2007
        name: { en: 'Cured', es: 'Curado' },
      },
      {
        slug: 'semi-cured', // L2345
        name: { en: 'Semi-cured', es: 'Semicurado' },
      },
      {
        slug: 'young-mild', // L2346
        name: { en: 'Young/Mild', es: 'Tierno' },
      },
      {
        slug: 'cheeses-fresh', // L2008
        name: { en: 'Fresh', es: 'Fresco' },
      },
      {
        slug: 'specialties', // L2011
        name: { en: 'Specialties', es: 'Especialidades' },
      },
      {
        slug: 'blue-and-goat-cheese', // L2009
        name: { en: 'Blue and goat cheese', es: 'Azul y de cabra' },
      },
      {
        slug: 'sliced', // L2205
        name: { en: 'Sliced', es: 'En lonchas' },
      },
      {
        slug: 'shredded-grated', // L2347
        name: { en: 'Shredded/Grated', es: 'Rallado' },
      },
      {
        slug: 'spreadable-and-portions', // L2010
        name: { en: 'Spreadable and portions', es: 'Untable y en porciones' },
      },
    ],
  },
  {
    slug: 'eggs-milk-and-butter', // L108
    name: { en: 'Eggs, milk, and butter', es: 'Huevos, leche y mantequilla' },
    children: [
      {
        slug: 'eggs', // L2055
        name: { en: 'Eggs', es: 'Huevos' },
      },
      {
        slug: 'milk', // L2051
        name: { en: 'Milk', es: 'Leche' },
      },
      {
        slug: 'lactose-free-and-fortified-milk', // L2261
        name: {
          en: 'Lactose-free and fortified milk',
          es: 'Leche sin lactosa y enriquecidas',
        },
      },
      {
        slug: 'plant-based-drinks-and-horchata', // L2052
        name: {
          en: 'Plant-based drinks and horchata',
          es: 'Bebidas vegetales y horchatas',
        },
      },
      {
        slug: 'infant-formula', // L2262
        name: { en: 'Infant formula', es: 'Leche infantil' },
      },
      {
        slug: 'milkshakes', // L2053
        name: { en: 'Milkshakes', es: 'Batidos' },
      },
      {
        slug: 'condensed-and-evaporated-milk', // L2264
        name: {
          en: 'Condensed and evaporated milk',
          es: 'Leche condensada y evaporada',
        },
      },
      {
        slug: 'butter-and-margarine', // L2056
        name: { en: 'Butter and margarine', es: 'Mantequilla y margarina' },
      },
      {
        slug: 'cream', // L2054
        name: { en: 'Cream', es: 'Nata' },
      },
    ],
  },
  {
    slug: 'bakery', // L112
    name: { en: 'Bakery', es: 'Panadería' },
    children: [
      {
        slug: 'freshly-baked-bread', // L2070
        name: { en: 'Freshly baked bread', es: 'Pan recién horneado' },
      },
      {
        slug: 'sliced-and-specialty-breads', // L2069
        name: {
          en: 'Sliced and specialty breads',
          es: 'Pan de molde y especiales',
        },
      },
      {
        slug: 'hamburger-and-hot-dog-buns', // L2073
        name: {
          en: 'Hamburger and hot dog buns',
          es: 'Pan para hamburguesas y perritos',
        },
      },
      {
        slug: 'wheat-tortillas-and-pita-bread', // L2074
        name: {
          en: 'Wheat tortillas and pita bread',
          es: 'Tortillas de trigo y pitas',
        },
      },
      {
        slug: 'gluten-free-bread', // L2200
        name: { en: 'Gluten-free bread', es: 'Pan sin gluten' },
      },
      {
        slug: 'breadcrumbs-toasted-bread-and-breadsticks', // L2072
        name: {
          en: 'Breadcrumbs, toasted bread, and breadsticks',
          es: 'Pan rallado, tostado y picos',
        },
      },
      {
        slug: 'oven', // L2304
        name: { en: 'Oven', es: 'Horno' },
      },
      {
        slug: 'doughs-and-pastries', // L2076
        name: { en: 'Doughs and pastries', es: 'Masas y hojaldres' },
      },
    ],
  },
  {
    slug: 'yoghurts-and-desserts', // L113
    name: { en: 'Yoghurts and desserts', es: 'Yogures y postres' },
    children: [
      {
        slug: 'natural-and-skimmed-yogurts', // L2079
        name: {
          en: 'Natural and skimmed yogurts',
          es: 'Yogures naturales y desnatados',
        },
      },
      {
        slug: 'flavoured-and-fruit-yoghurts', // L2081
        name: {
          en: 'Flavoured and fruit yoghurts',
          es: 'Yogures de sabores y frutas',
        },
      },
      {
        slug: 'greek-yogurts', // L2082
        name: { en: 'Greek yogurts', es: 'Yogures griegos' },
      },
      {
        slug: 'liquid-yogurts', // L2248
        name: { en: 'Liquid yogurts', es: 'Yogures líquidos' },
      },
      {
        slug: 'bifidus-yoghurts-and-cholesterol', // L2078
        name: {
          en: 'Bifidus yoghurts and cholesterol',
          es: 'Yogures bífidus y colesterol',
        },
      },
      {
        slug: 'kefir-and-plant-based-desserts', // L2085
        name: {
          en: 'Kefir and plant-based desserts',
          es: 'Kéfir y postres vegetales',
        },
      },
      {
        slug: 'protein-desserts-and-yogurts', // L2229
        name: {
          en: 'Desserts and protein shakes',
          es: 'Postres y batidos de proteínas',
        },
      },
      {
        slug: 'yogurts-and-children-s-desserts', // L2083
        name: {
          en: "Yogurts and children's desserts",
          es: 'Yogures y postres infantiles',
        },
      },
      {
        slug: 'traditional-desserts', // L2087
        name: { en: 'Traditional desserts', es: 'Postres tradicionales' },
      },
      {
        slug: 'custard-flan-and-rice-pudding', // L2088
        name: {
          en: 'Custard, flan, and rice pudding',
          es: 'Natillas, flan y arroz con leche',
        },
      },
      {
        slug: 'gelatins-and-curds', // L2089
        name: { en: 'Gelatins and curds', es: 'Gelatinas y cuajadas' },
      },
    ],
  },
  {
    slug: 'frozen-foods-and-ice-cream', // L119
    name: { en: 'Frozen foods and ice cream', es: 'Congelados y helados' },
    children: [
      {
        slug: 'pizzas-and-doughs', // L2131
        name: { en: 'Pizzas and doughs', es: 'Pizzas y masas' },
      },
      {
        slug: 'croquettes-and-batters', // L2135
        name: { en: 'Croquettes and batters', es: 'Croquetas y rebozados' },
      },
      {
        slug: 'frozen-foods-and-ice-cream-fish-and-seafood', // L2132
        name: { en: 'Fish and seafood', es: 'Pescado y marisco' },
      },
      {
        slug: 'vegetables-and-potatoes', // L2210
        name: { en: 'Vegetables and potatoes', es: 'Verduras y patatas' },
      },
      {
        slug: 'rice-and-pasta', // L2137
        name: { en: 'Rice and pasta', es: 'Arroces y pasta' },
      },
      {
        slug: 'ice-creams-and-ice', // L2130
        name: { en: 'Ice creams and ice', es: 'Helados y hielo' },
      },
      {
        slug: 'cakes-and-churros', // L2136
        name: { en: 'Cakes and churros', es: 'Tartas y churros' },
      },
    ],
  },
  {
    slug: 'rice-pasta-and-pulses', // L106
    name: { en: 'Rice, pasta and pulses', es: 'Arroz, pastas y legumbres' },
    children: [
      {
        slug: 'rice', // L2042
        name: { en: 'Rice', es: 'Arroz' },
      },
      {
        slug: 'rice-pasta-and-pulses-fideos', // L2270
        name: { en: 'Noodles', es: 'Fideos' },
      },
      {
        slug: 'macaroni-spaghetti-and-dried-pasta', // L2044
        name: {
          en: 'Macaroni, spaghetti, and dried pasta',
          es: 'Macarrones, espaguetis y pastas secas',
        },
      },
      {
        slug: 'filled-and-sauced-pasta', // L2271
        name: {
          en: 'Filled and Sauced Pasta',
          es: 'Pastas rellenas y en salsa',
        },
      },
      {
        slug: 'lasagna-and-cannelloni', // L2272
        name: { en: 'Lasagna and cannelloni', es: 'Lasaña y canelones' },
      },
      {
        slug: 'pasta-sauces', // L2297
        name: { en: 'Pasta sauces', es: 'Salsas para pasta' },
      },
      {
        slug: 'rice-pasta-and-pulses-noodles', // L2273
        name: { en: 'Noodles', es: 'Noodles' },
      },
      {
        slug: 'gluten-free-pasta', // L2274
        name: { en: 'Gluten-free pasta', es: 'Pastas sin gluten' },
      },
      {
        slug: 'chickpeas-and-beans', // L2191
        name: { en: 'Chickpeas and beans', es: 'Garbanzos y alubias' },
      },
      {
        slug: 'lentils', // L2193
        name: { en: 'Lentils', es: 'Lentejas' },
      },
      {
        slug: 'quinoa-couscous-and-soy', // L2043
        name: {
          en: 'Quinoa, couscous, and soy',
          es: 'Quinoa, couscous y soja',
        },
      },
    ],
  },
  {
    slug: 'oils-sauces-and-spices', // L107
    name: { en: 'Oils, sauces and spices', es: 'Aceites, salsas y especias' },
    children: [
      {
        slug: 'oils', // L2046
        name: { en: 'Oils', es: 'Aceites' },
      },
      {
        slug: 'vinegars-and-dressings', // L2047
        name: { en: 'Vinegars and dressings', es: 'Vinagres y aliños' },
      },
      {
        slug: 'garlic-salt-and-pepper', // L2048
        name: { en: 'Garlic, salt, and pepper', es: 'Ajo, sal y pimienta' },
      },
      {
        slug: 'spices-and-herbs', // L2294
        name: { en: 'Spices and herbs', es: 'Especias y hierbas' },
      },
      {
        slug: 'seasonings', // L2295
        name: { en: 'Seasonings', es: 'Sazonadores' },
      },
      {
        slug: 'tomato-and-pasta-sauces', // L2208
        name: { en: 'Tomato and pasta sauces', es: 'Salsas de tomate y pasta' },
      },
      {
        slug: 'special-and-spicy-sauces', // L2296
        name: {
          en: 'Special and spicy sauces',
          es: 'Salsas especiales y picantes',
        },
      },
      {
        slug: 'ketchup-mayonnaise-and-mustard', // L2050
        name: {
          en: 'Ketchup, mayonnaise, and mustard',
          es: 'Ketchup, mayonesa y mostaza',
        },
      },
    ],
  },
  {
    slug: 'canned-food-broths-and-creams', // L114
    name: {
      en: 'Canned food, broths and creams',
      es: 'Conservas, caldos y cremas',
    },
    children: [
      {
        slug: 'tuna-and-bonito', // L2179
        name: { en: 'Tuna and bonito', es: 'Atún y bonito' },
      },
      {
        slug: 'mackerel-and-sardines', // L2207
        name: { en: 'Mackerel and sardines', es: 'Caballa y sardinas' },
      },
      {
        slug: 'mussels-cockles-and-fish', // L2195
        name: {
          en: 'Mussels, cockles, and fish',
          es: 'Mejillones, berberechos y pescado',
        },
      },
      {
        slug: 'pates', // L2341
        name: { en: 'Pâtés', es: 'Patés' },
      },
      {
        slug: 'canned-food-broths-and-creams-canned-vegetables', // L2092
        name: { en: 'Canned vegetables', es: 'Conservas de verdura' },
      },
      {
        slug: 'canned-fruit', // L2298
        name: { en: 'Canned fruit', es: 'Conservas de fruta' },
      },
      {
        slug: 'creams-and-purees', // L2094
        name: { en: 'Creams and purées', es: 'Cremas y purés' },
      },
      {
        slug: 'broths-and-soups', // L2093
        name: { en: 'Broths and soups', es: 'Caldos y sopas' },
      },
    ],
  },
  {
    slug: 'coffee-cocoa-and-infusions', // L109
    name: { en: 'Coffee, cocoa and infusions', es: 'Café, cacao e infusiones' },
    children: [
      {
        slug: 'compatible-nespresso-capsules', // L2057
        name: {
          en: 'Compatible Nespresso capsules',
          es: 'Cápsulas compatibles Nespresso',
        },
      },
      {
        slug: 'compatible-dolce-gusto-capsules', // L2275
        name: {
          en: 'Compatible Dolce Gusto capsules',
          es: 'Cápsulas compatibles Dolce Gusto',
        },
      },
      {
        slug: 'other-compatible-capsules', // L2276
        name: {
          en: 'Other compatible capsules',
          es: 'Otras cápsulas compatibles',
        },
      },
      {
        slug: 'ground-coffee', // L2277
        name: { en: 'Ground coffee', es: 'Café molido' },
      },
      {
        slug: 'instant-coffee', // L2278
        name: { en: 'Instant coffee', es: 'Café soluble' },
      },
      {
        slug: 'whole-bean-coffee', // L2279
        name: { en: 'Whole bean coffee', es: 'Café en grano' },
      },
      {
        slug: 'cold-brew-coffee', // L2280
        name: { en: 'Cold brew coffee', es: 'Cafés fríos' },
      },
      {
        slug: 'cocoa-and-hot-chocolate', // L2058
        name: {
          en: 'Cocoa and hot chocolate',
          es: 'Cacao y chocolate a la taza',
        },
      },
      {
        slug: 'infusions', // L2059
        name: { en: 'Infusions', es: 'Infusiones' },
      },
      {
        slug: 'tea', // L2281
        name: { en: 'Tea', es: 'Té' },
      },
    ],
  },
  {
    slug: 'pastries-cakes-and-sugar', // L132
    name: {
      en: 'Pastries, cakes, and sugar',
      es: 'Bollería, repostería y azúcar',
    },
    children: [
      {
        slug: 'sweet-baked-goods', // L2317
        name: { en: 'Sweet baked goods', es: 'Bollería de horno dulce' },
      },
      {
        slug: 'muffins-and-classic-pastries', // L2067
        name: {
          en: 'Muffins and classic pastries',
          es: 'Magdalenas y bollería clásica',
        },
      },
      {
        slug: 'doughnuts-and-cakes', // L2318
        name: { en: 'Doughnuts and cakes', es: 'Rosquillas y pastelitos' },
      },
      {
        slug: 'pastries-cakes-and-sugar-cakes', // L2319
        name: { en: 'Cakes', es: 'Tartas' },
      },
      {
        slug: 'flours-and-yeasts', // L2075
        name: { en: 'Flours and yeasts', es: 'Harinas y levaduras' },
      },
      {
        slug: 'dessert-mixes-and-decorations', // L2077
        name: {
          en: 'Dessert mixes and decorations',
          es: 'Preparados para postres y decoración',
        },
      },
      {
        slug: 'sugar-honey-and-sweeteners', // L2060
        name: {
          en: 'Sugar, honey, and sweeteners',
          es: 'Azúcar, miel y edulcorantes',
        },
      },
    ],
  },
  {
    slug: 'biscuits-cereals-and-jams', // L111
    name: {
      en: 'Biscuits, cereals, and jams',
      es: 'Galletas, cereales y mermeladas',
    },
    children: [
      {
        slug: 'chocolate-and-filled-biscuits', // L2320
        name: {
          en: 'Chocolate and filled biscuits',
          es: 'Galletas de chocolate y rellenas',
        },
      },
      {
        slug: 'classic-and-digestive-biscuits', // L2065
        name: {
          en: 'Classic and digestive biscuits',
          es: 'Galletas clásicas y digestive',
        },
      },
      {
        slug: 'savory-biscuits-and-crackers', // L2066
        name: {
          en: 'Savory biscuits and crackers',
          es: 'Galletas saladas y crackers',
        },
      },
      {
        slug: 'cereals', // L2068
        name: { en: 'Cereals', es: 'Cereales' },
      },
      {
        slug: 'whole-grain-cereals-and-muesli', // L2321
        name: {
          en: 'Whole grain cereals and muesli',
          es: 'Cereales integrales y muesli',
        },
      },
      {
        slug: 'cereal-and-protein-bars', // L2322
        name: {
          en: 'Cereal and protein bars',
          es: 'Barritas de cereales y proteínas',
        },
      },
      {
        slug: 'biscuits-cereals-and-jams-cakes', // L2216
        name: { en: 'Cakes', es: 'Tortitas' },
      },
      {
        slug: 'gluten-free-biscuits-cereals-and-pancakes', // L2323
        name: {
          en: 'Gluten-free biscuits, cereals, and pancakes',
          es: 'Galletas, cereales y tortitas sin gluten',
        },
      },
      {
        slug: 'jams', // L2062
        name: { en: 'Jams', es: 'Mermeladas' },
      },
    ],
  },
  {
    slug: 'chocolates-and-sweets', // L110
    name: { en: 'Chocolates and sweets', es: 'Chocolates y golosinas' },
    children: [
      {
        slug: 'milk-chocolate', // L2324
        name: { en: 'Milk chocolate', es: 'Chocolate con leche' },
      },
      {
        slug: 'dark-chocolate', // L2325
        name: { en: 'Dark chocolate', es: 'Chocolate negro' },
      },
      {
        slug: 'white-chocolate', // L2326
        name: { en: 'White chocolate', es: 'Chocolate blanco' },
      },
      {
        slug: 'chocolates-and-bonbons', // L2063
        name: { en: 'Chocolates and bonbons', es: 'Chocolatinas y bombones' },
      },
      {
        slug: 'cocoa-spreads-and-creams', // L2228
        name: {
          en: 'Cocoa spreads and creams',
          es: 'Cremas de cacao y de untar',
        },
      },
      {
        slug: 'sweets', // L2064
        name: { en: 'Sweets', es: 'Golosinas' },
      },
      {
        slug: 'chewing-gum-and-candies', // L2327
        name: { en: 'Chewing gum and candies', es: 'Chicles y caramelos' },
      },
    ],
  },
  {
    slug: 'prepared-meals-and-pizzas', // L116
    name: { en: 'Prepared meals and pizzas', es: 'Platos preparados y pizzas' },
    children: [
      {
        slug: 'ready-to-eat-dishes', // L2102
        name: { en: 'Ready-to-eat dishes', es: 'Listos para comer' },
      },
      {
        slug: 'tortillas-and-pies', // L2105
        name: { en: 'Tortillas and pies', es: 'Tortillas y empanadas' },
      },
      {
        slug: 'refrigerated-pizzas', // L2101
        name: { en: 'Refrigerated pizzas', es: 'Pizzas refrigeradas' },
      },
      {
        slug: 'frozen-pizzas', // L2246
        name: { en: 'Frozen pizzas', es: 'Pizzas congeladas' },
      },
      {
        slug: 'sandwiches-and-burgers', // L2104
        name: { en: 'Sandwiches and Burgers', es: 'Sándwiches y hamburguesas' },
      },
      {
        slug: 'traditional-food', // L2247
        name: { en: 'Traditional Food', es: 'Comida tradicional' },
      },
      {
        slug: 'mexican-food', // L2103
        name: { en: 'Mexican Food', es: 'Comida mexicana' },
      },
      {
        slug: 'asian-food', // L2299
        name: { en: 'Asian Food', es: 'Comida asiática' },
      },
      {
        slug: 'salads-and-bowls', // L2300
        name: { en: 'Salads and Bowls', es: 'Ensaladas y bowls' },
      },
      {
        slug: 'gazpachos-and-salmorejos', // L2106
        name: { en: 'Gazpachos and salmorejos', es: 'Gazpachos y salmorejos' },
      },
      {
        slug: 'hummus-and-guacamole', // L2269
        name: { en: 'Hummus and guacamole', es: 'Hummus y guacamoles' },
      },
    ],
  },
  {
    slug: 'snacks-and-nuts', // L115
    name: { en: 'Snacks and nuts', es: 'Aperitivos y frutos secos' },
    children: [
      {
        slug: 'potato-chips', // L2098
        name: { en: 'Potato chips', es: 'Patatas fritas' },
      },
      {
        slug: 'savory-snacks', // L2282
        name: { en: 'Savory snacks', es: 'Snacks salados' },
      },
      {
        slug: 'vegetable-snacks', // L2285
        name: { en: 'Vegetable snacks', es: 'Snacks vegetales' },
      },
      {
        slug: 'nuts', // L2097
        name: { en: 'Nuts', es: 'Frutos secos' },
      },
      {
        slug: 'mixed-nuts', // L2283
        name: { en: 'Mixed nuts', es: 'Mix de frutos secos' },
      },
      {
        slug: 'dried-fruit', // L2041
        name: { en: 'Dried fruit', es: 'Frutas deshidratadas' },
      },
      {
        slug: 'olives', // L2096
        name: { en: 'Olives', es: 'Aceitunas' },
      },
      {
        slug: 'pickles', // L2284
        name: { en: 'Pickles', es: 'Encurtidos' },
      },
    ],
  },
  {
    slug: 'water-and-soft-drinks', // L117
    name: { en: 'Water and Soft Drinks', es: 'Agua y refrescos' },
    children: [
      {
        slug: 'water', // L2107
        name: { en: 'Water', es: 'Agua' },
      },
      {
        slug: 'cola', // L2108
        name: { en: 'Cola', es: 'Cola' },
      },
      {
        slug: 'orange-lemon-and-lemon-lime', // L2212
        name: {
          en: 'Orange, Lemon, and Lemon-Lime',
          es: 'Naranja, limón y lima-limón',
        },
      },
      {
        slug: 'tonic-sparkling-water-and-bitter', // L2112
        name: {
          en: 'Tonic, Sparkling Water, and Bitter',
          es: 'Tónica, gaseosa y bitter',
        },
      },
      {
        slug: 'iced-tea', // L2111
        name: { en: 'Iced Tea', es: 'Té frío' },
      },
      {
        slug: 'non-carbonated-soft-drinks', // L2192
        name: { en: 'Non-Carbonated Soft Drinks', es: 'Refrescos sin gas' },
      },
      {
        slug: 'isotonic-and-sports-drinks', // L2114
        name: {
          en: 'Isotonic and sports drinks',
          es: 'Bebidas isotónicas y deportivas',
        },
      },
      {
        slug: 'energy-drinks', // L2217
        name: { en: 'Energy drinks', es: 'Bebidas energéticas' },
      },
      {
        slug: 'kombucha-and-vitamin-infused-waters', // L2110
        name: {
          en: 'Kombucha and Vitamin-Infused Waters',
          es: 'Kombucha y aguas vitaminadas',
        },
      },
      {
        slug: 'water-and-soft-drink-packs', // L2286
        name: {
          en: 'Water and Soft Drink Packs',
          es: 'Packs de agua y refrescos',
        },
      },
    ],
  },
  {
    slug: 'juices-and-smoothies', // L127
    name: { en: 'Juices and Smoothies', es: 'Zumos y smoothies' },
    children: [
      {
        slug: 'freshly-squeezed-and-fresh', // L2113
        name: {
          en: 'Freshly squeezed and fresh',
          es: 'Recién exprimido y fresco',
        },
      },
      {
        slug: 'orange', // L2287
        name: { en: 'Orange', es: 'Naranja' },
      },
      {
        slug: 'lemonade', // L2312
        name: { en: 'Lemonade', es: 'Limonadas' },
      },
      {
        slug: 'peach-and-pineapple', // L2288
        name: { en: 'Peach and Pineapple', es: 'Melocotón y piña' },
      },
      {
        slug: 'multifruit-and-other-flavors', // L2289
        name: {
          en: 'Multifruit and Other Flavors',
          es: 'Multifrutas y otros sabores',
        },
      },
      {
        slug: 'fruit-and-milk', // L2290
        name: { en: 'Fruit and Milk', es: 'Fruta y leche' },
      },
      {
        slug: 'smoothies', // L2291
        name: { en: 'Smoothies', es: 'Smoothies' },
      },
      {
        slug: 'juice-packs', // L2292
        name: { en: 'Juice Packs', es: 'Packs de zumos' },
      },
    ],
  },
  {
    slug: 'beers-wines-and-spirits', // L118
    name: { en: 'Beers, wines, and spirits', es: 'Cervezas, vinos y licores' },
    children: [
      {
        slug: 'beers', // L2115
        name: { en: 'Beers', es: 'Cervezas' },
      },
      {
        slug: 'premium-and-specialty-beers', // L2117
        name: {
          en: 'Premium and specialty beers',
          es: 'Cervezas prémium y especiales',
        },
      },
      {
        slug: 'beers-with-lemon', // L2182
        name: { en: 'Beers with lemon', es: 'Cervezas con limón' },
      },
      {
        slug: 'non-alcoholic-beers', // L2118
        name: { en: 'Non-alcoholic beers', es: 'Cervezas sin alcohol' },
      },
      {
        slug: 'beer-packs', // L2293
        name: { en: 'Beer packs', es: 'Packs de cervezas' },
      },
      {
        slug: 'summer-red-wine-and-sangria', // L2119
        name: {
          en: 'Summer red wine and sangria',
          es: 'Tinto de verano y sangría',
        },
      },
      {
        slug: 'red-wine', // L2120
        name: { en: 'Red wine', es: 'Vino tinto' },
      },
      {
        slug: 'white-wine', // L2121
        name: { en: 'White wine', es: 'Vino blanco' },
      },
      {
        slug: 'rose-wine', // L2124
        name: { en: 'Rose wine', es: 'Vino rosado' },
      },
      {
        slug: 'cavas-and-cider', // L2122
        name: { en: 'Cavas and cider', es: 'Cavas y sidra' },
      },
      {
        slug: 'gin-vodka-and-tequila', // L2125
        name: { en: 'Gin, vodka and tequila', es: 'Ginebra, vodka y tequila' },
      },
      {
        slug: 'ron-and-whisky', // L2128
        name: { en: 'Ron and whisky', es: 'Ron y whisky' },
      },
      {
        slug: 'vermouth-and-aperitifs', // L2127
        name: { en: 'Vermouth and aperitifs', es: 'Vermouth y aperitivos' },
      },
      {
        slug: 'creams-liqueurs-and-brandy', // L2129
        name: {
          en: 'Creams, liqueurs, and brandy',
          es: 'Cremas, licores y brandy',
        },
      },
      {
        slug: 'sherry-and-fortified-wines', // ours, plan 0179
        name: {
          en: 'Sherry and fortified wines',
          es: 'Vinos generosos y dulces',
        },
      },
      {
        slug: 'premixed-drinks', // ours, plan 0179
        name: { en: 'Premixed drinks', es: 'Combinados y bebidas con alcohol' },
      },
    ],
  },
  {
    slug: 'cleaning-and-home', // L122
    name: { en: 'Cleaning and home', es: 'Limpieza y hogar' },
    children: [
      {
        slug: 'detergents', // L2170
        name: { en: 'Detergents', es: 'Detergentes' },
      },
      {
        slug: 'fabric-softeners-and-laundry-care', // L2306
        name: {
          en: 'Fabric softeners and laundry care',
          es: 'Suavizantes y cuidado de la ropa',
        },
      },
      {
        slug: 'dishwasher', // L2167
        name: { en: 'Dishwasher', es: 'Lavavajillas' },
      },
      {
        slug: 'toilet-paper-kitchen-paper-and-napkins', // L2168
        name: {
          en: 'Toilet paper, kitchen paper and napkins',
          es: 'Papel higiénico, cocina y servilletas',
        },
      },
      {
        slug: 'garbage-bags-brooms-and-mops', // L2160
        name: {
          en: 'Garbage bags, brooms and mops',
          es: 'Bolsas de basura, escobas y fregonas',
        },
      },
      {
        slug: 'kitchen-cleaning-and-degreasing', // L2166
        name: {
          en: 'Kitchen cleaning and degreasing',
          es: 'Limpieza cocina y quitagrasas',
        },
      },
      {
        slug: 'bathroom-and-toilet-cleaning', // L2164
        name: { en: 'Bathroom and toilet cleaning', es: 'Limpieza baño y WC' },
      },
      {
        slug: 'cleaning-floors-windows-and-furniture', // L2163
        name: {
          en: 'Cleaning floors, windows and furniture',
          es: 'Limpieza suelos, cristales y muebles',
        },
      },
      {
        slug: 'bleach-and-disinfectants', // L2161
        name: { en: 'Bleach and disinfectants', es: 'Lejía y desinfectantes' },
      },
      {
        slug: 'film-aluminum-and-preservation', // L2169
        name: {
          en: 'Film, aluminum and preservation',
          es: 'Film, aluminio y conservación',
        },
      },
      {
        slug: 'scouring-pads-cloths-and-gloves', // L2159
        name: {
          en: 'Scouring pads, cloths and gloves',
          es: 'Estropajos, bayetas y guantes',
        },
      },
      {
        slug: 'air-fresheners-refills-and-candles', // L2226
        name: {
          en: 'Air fresheners, refills and candles',
          es: 'Ambientadores, recambios y velas',
        },
      },
      {
        slug: 'insecticides', // L2173
        name: { en: 'Insecticides', es: 'Insecticidas' },
      },
      {
        slug: 'batteries-kitchenware-and-bags', // L2209
        name: {
          en: 'Batteries, kitchenware and bags',
          es: 'Pilas, menaje y bolsas',
        },
      },
      {
        slug: 'shoe-care', // ours, plan 0179
        name: { en: 'Shoe care', es: 'Cuidado del calzado' },
      },
    ],
  },
  {
    slug: 'hygiene-and-body-care', // L129
    name: { en: 'Hygiene and Body Care', es: 'Higiene y cuidado del cuerpo' },
    children: [
      {
        slug: 'shower-gel-and-sponges', // L2211
        name: { en: 'Shower gel and sponges', es: 'Gel de ducha y esponjas' },
      },
      {
        slug: 'oral-hygiene', // L2151
        name: { en: 'Oral hygiene', es: 'Higiene bucal' },
      },
      {
        slug: 'deodorants', // L2154
        name: { en: 'Deodorants', es: 'Desodorantes' },
      },
      {
        slug: 'shaving', // L2150
        name: { en: 'Shaving', es: 'Afeitado' },
      },
      {
        slug: 'hair-removal', // L2188
        name: { en: 'Hair removal', es: 'Depilación' },
      },
      {
        slug: 'sanitary-pads-and-feminine-hygiene', // L2158
        name: {
          en: 'Sanitary pads and feminine hygiene',
          es: 'Compresas e higiene íntima',
        },
      },
      {
        slug: 'body-and-hand-hydration', // L2153
        name: {
          en: 'Body and hand hydration',
          es: 'Hidratación de cuerpo y manos',
        },
      },
      {
        slug: 'hand-soap', // L2156
        name: { en: 'Hand soap', es: 'Jabón de manos' },
      },
    ],
  },
  {
    slug: 'hair-and-perfumery', // L130
    name: { en: 'Hair and Perfumery', es: 'Cabello y perfumería' },
    children: [
      {
        slug: 'shampoo', // L2144
        name: { en: 'Shampoo', es: 'Champú' },
      },
      {
        slug: 'conditioners-and-masks', // L2145
        name: {
          en: 'Conditioners and masks',
          es: 'Acondicionadores y mascarillas',
        },
      },
      {
        slug: 'foams-and-fixers', // L2146
        name: { en: 'Foams and fixers', es: 'Espumas y fijadores' },
      },
      {
        slug: 'dyes', // L2147
        name: { en: 'Dyes', es: 'Tintes' },
      },
      {
        slug: 'facial-care', // L2148
        name: { en: 'Facial Care', es: 'Cuidado facial' },
      },
      {
        slug: 'perfumes-and-colognes', // L2155
        name: { en: 'Perfumes and colognes', es: 'Perfumes y colonias' },
      },
      {
        slug: 'hair-accessories', // ours, plan 0179
        name: { en: 'Hair accessories', es: 'Accesorios para el cabello' },
      },
    ],
  },
  {
    slug: 'health-and-pharmacy', // L131
    name: { en: 'Health and Pharmacy', es: 'Salud y parafarmacia' },
    children: [
      {
        slug: 'nutritional-supplements', // L2183
        name: {
          en: 'Nutritional supplements',
          es: 'Complementos nutricionales',
        },
      },
      {
        slug: 'parapharmacy', // L2184
        name: { en: 'Parapharmacy', es: 'Parafarmacia' },
      },
      {
        slug: 'first-aid-kit', // L2307
        name: { en: 'First Aid Kit', es: 'Botiquín' },
      },
      {
        slug: 'sunscreen', // L2340
        name: { en: 'Sunscreen', es: 'Protector solar' },
      },
    ],
  },
  {
    slug: 'children', // L120
    name: { en: 'Children', es: 'Infantil' },
    children: [
      {
        slug: 'milk-and-baby-food', // L2138
        name: { en: 'Milk and Baby Food', es: 'Leches y papillas' },
      },
      {
        slug: 'baby-foods-and-jars', // L2141
        name: { en: 'Baby foods and jars', es: 'Potitos y tarritos' },
      },
      {
        slug: 'yogurt-and-desserts', // L2139
        name: { en: 'Yogurt and Desserts', es: 'Yogures y postres' },
      },
      {
        slug: 'pots-and-snacks', // L2140
        name: { en: 'Pots and Snacks', es: 'Bolsitas y snacks' },
      },
      {
        slug: 'diapers-and-wipes', // L2142
        name: { en: 'Diapers and wipes', es: 'Pañales y toallitas' },
      },
      {
        slug: 'hygiene-and-care', // L2143
        name: { en: 'Hygiene and Care', es: 'Higiene y cuidado' },
      },
      {
        slug: 'children-juices-and-smoothies', // L2314
        name: { en: 'Juices and Smoothies', es: 'Zumos y batidos' },
      },
      {
        slug: 'cookies-and-pastries', // L2315
        name: { en: 'Cookies and Pastries', es: 'Galletas y bollería' },
      },
      {
        slug: 'sweets-and-chocolates', // L2316
        name: { en: 'Sweets and Chocolates', es: 'Golosinas y chocolatinas' },
      },
    ],
  },
  {
    slug: 'pets', // L123
    name: { en: 'Pets', es: 'Mascotas' },
    children: [
      {
        slug: 'wet-cat-food', // L2308
        name: { en: 'Wet cat food', es: 'Gato comida húmeda' },
      },
      {
        slug: 'dry-cat-food', // L2175
        name: { en: 'Dry cat food', es: 'Gato comida seca' },
      },
      {
        slug: 'cat-treats-and-care', // L2309
        name: { en: 'Cat treats and care', es: 'Gato snacks y cuidado' },
      },
      {
        slug: 'wet-dog-food', // L2310
        name: { en: 'Wet dog food', es: 'Perro comida húmeda' },
      },
      {
        slug: 'dry-dog-food', // L2174
        name: { en: 'Dry dog food', es: 'Perro comida seca' },
      },
      {
        slug: 'dog-treats-and-care', // L2311
        name: { en: 'Dog treats and care', es: 'Perro snacks y cuidado' },
      },
      {
        slug: 'bird-food-and-care', // ours, plan 0179
        name: { en: 'Birds', es: 'Pájaros' },
      },
      {
        slug: 'small-animal-food-and-care', // ours, plan 0179
        name: { en: 'Rodents and rabbits', es: 'Roedores y conejos' },
      },
      {
        slug: 'fish-and-reptile-care', // ours, plan 0179
        name: { en: 'Fish and reptiles', es: 'Peces y reptiles' },
      },
      {
        slug: 'pet-accessories', // ours, plan 0179
        name: { en: 'Pet accessories', es: 'Accesorios para mascotas' },
      },
    ],
  },
  {
    slug: 'makeup', // ours, plan 0179
    name: { en: 'Make-up', es: 'Maquillaje' },
    children: [
      {
        slug: 'face-makeup', // ours, plan 0179
        name: { en: 'Foundations and concealers', es: 'Bases y correctores' },
      },
      {
        slug: 'powders-and-blush', // ours, plan 0179
        name: { en: 'Powders and blush', es: 'Polvos y colorete' },
      },
      {
        slug: 'eye-makeup', // ours, plan 0179
        name: { en: 'Eyes', es: 'Ojos' },
      },
      {
        slug: 'lip-makeup', // ours, plan 0179
        name: { en: 'Lips', es: 'Labios' },
      },
      {
        slug: 'nail-care', // ours, plan 0179
        name: { en: 'Nails', es: 'Manicura y pedicura' },
      },
      {
        slug: 'makeup-tools', // ours, plan 0179
        name: { en: 'Brushes and tools', es: 'Brochas y accesorios' },
      },
    ],
  },
  {
    slug: 'home-and-garden', // ours, plan 0179
    name: { en: 'Home and garden', es: 'Hogar y jardín' },
    children: [
      {
        slug: 'home-textiles', // ours, plan 0179
        name: { en: 'Home textiles', es: 'Textil hogar' },
      },
      {
        slug: 'home-decor', // ours, plan 0179
        name: { en: 'Home decor', es: 'Decoración' },
      },
      {
        slug: 'storage-and-organisation', // ours, plan 0179
        name: { en: 'Storage and organisation', es: 'Orden y almacenaje' },
      },
      {
        slug: 'garden-and-plants', // ours, plan 0179
        name: { en: 'Garden and plants', es: 'Jardín y plantas' },
      },
      {
        slug: 'diy-and-hardware', // ours, plan 0179
        name: { en: 'DIY and hardware', es: 'Bricolaje y ferretería' },
      },
      {
        slug: 'lighting-and-electrical', // ours, plan 0179
        name: {
          en: 'Lighting and electrical',
          es: 'Iluminación y electricidad',
        },
      },
      {
        slug: 'small-appliances', // ours, plan 0179
        name: { en: 'Small appliances', es: 'Pequeño electrodoméstico' },
      },
      {
        slug: 'car-care', // ours, plan 0179
        name: { en: 'Car care', es: 'Cuidado del coche' },
      },
    ],
  },
  {
    slug: 'leisure-and-stationery', // ours, plan 0179
    name: { en: 'Leisure and stationery', es: 'Ocio y papelería' },
    children: [
      {
        slug: 'stationery-and-school', // ours, plan 0179
        name: {
          en: 'Stationery and school',
          es: 'Papelería y material escolar',
        },
      },
      {
        slug: 'books', // ours, plan 0179
        name: { en: 'Books', es: 'Libros' },
      },
      {
        slug: 'magazines-and-collectibles', // ours, plan 0179
        name: {
          en: 'Magazines and collectibles',
          es: 'Revistas y coleccionables',
        },
      },
      {
        slug: 'toys-and-games', // ours, plan 0179
        name: { en: 'Toys and games', es: 'Juguetes y juegos' },
      },
      {
        slug: 'party-and-celebrations', // ours, plan 0179
        name: { en: 'Party and costumes', es: 'Fiestas y disfraces' },
      },
      {
        slug: 'beach-and-pool', // ours, plan 0179
        name: { en: 'Beach and pool', es: 'Playa y piscina' },
      },
    ],
  },
  {
    slug: 'clothing-and-accessories', // ours, plan 0179
    name: { en: 'Clothing and accessories', es: 'Ropa y complementos' },
    children: [
      {
        slug: 'clothing', // ours, plan 0179
        name: { en: 'Clothing', es: 'Ropa' },
      },
      {
        slug: 'clothing-accessories', // ours, plan 0179
        name: { en: 'Accessories', es: 'Complementos' },
      },
    ],
  },
  {
    slug: 'other', // ours, no DIA id
    name: { en: 'Other', es: 'Otros' },
    children: [
      {
        slug: 'uncategorised', // ours, no DIA id
        name: { en: 'Not yet categorised', es: 'Sin categoría' },
      },
    ],
  },
];

/**
 * The leaf a product lands on when nothing better is known (plan 0166,
 * appendix A): the only child of the root `other`.
 */
export const UNCATEGORISED_SLUG = 'uncategorised';

/** One row of the taxonomy as the `categories` table holds it. */
export interface ReferenceCategoryRow {
  id: string;
  parentId: string | null;
  slug: string;
  name: ReferenceCategoryRoot['name'];
  position: number;
}

/**
 * The taxonomy as rows, roots first and then every child, each numbered by
 * where it sits among its siblings.
 *
 * Roots first because a child's parent has to exist before it does, and the
 * seed writes them in this order.
 */
export function referenceCategoryRows(): ReferenceCategoryRow[] {
  const roots = REFERENCE_CATEGORIES.map((root, position) => ({
    id: categoryId(root.slug),
    parentId: null,
    slug: root.slug,
    name: root.name,
    position,
  }));
  const children = REFERENCE_CATEGORIES.flatMap((root) =>
    root.children.map((child, position) => ({
      id: categoryId(child.slug),
      parentId: categoryId(root.slug),
      slug: child.slug,
      name: child.name,
      position,
    }))
  );
  return [...roots, ...children];
}

/** Every leaf slug the taxonomy holds, for the checks that name one. */
export const REFERENCE_LEAF_SLUGS: ReadonlySet<string> = new Set(
  REFERENCE_CATEGORIES.flatMap((root) => root.children.map((c) => c.slug))
);
