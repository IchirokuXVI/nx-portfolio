> **PR:** [#612](https://github.com/IchirokuXVI/nx-portfolio/pull/612)

# 0179: categories for what DIA does not sell

> Found by the curation of the October 2026 harvest on local slot 1. The evidence is in the
> git ignored handoff `.curation-runs/2026-10-deza-staging/README.md` on the developer's
> machine, and in the `work/review.jsonl` logs under `harvest-curation/curate*/`.
>
> Prerequisite reading: plan `0173` (DIA's tree replaces the first one) and its migration
> `1758500000000-DiaCategoryTree.ts` (`DIA_CATEGORY_TREE`, `ROOT_REMAP`, `LEAF_REMAP`),
> `category-leaves.ts` in the Mercadona and LIDL libraries, and the category fixtures of
> velista, the admin and curation, which are slices of the tree on purpose.

DIA's tree has 29 roots and 246 leaves, and it describes what DIA sells online. Mercadona,
Deza and El Jamón sell more. The harvest found make-up, books, magazines, stationery, home
textiles, garden, DIY, party goods, toys, bird and rodent food, shoe care and fortified
wines. None of them has a leaf. So curators sent about 1,100 Deza rows to review without a
call, filed make-up under `facial-care`, and filed 31 products under `uncategorised`.

## Brief for the agent

### Objective

Add the roots and leaves below to the category tree in one additive migration, map the
chain sections that hold those products onto them, and keep every existing slug.

### Context

- The tree is rows (plan 0166) with Spanish and English names, written by a migration.
  Leaves are what a product and a chain section point at.
- The owner asked to model the new categories on other Spanish supermarkets and shopping
  apps. QuéFalta does not publish its tree: it shows each supermarket's own sections.
  Carrefour and Alcampo refuse automated fetches. So the sources here are Mercadona's own
  tree (`libs/luna-shopper/mercadona`) and the section paths Deza and El Jamón printed in
  this harvest.
- Mercadona has a root "Maquillaje" (Labios, Ojos, Bases de maquillaje y corrector,
  Colorete y polvos), "Manicura y pedicura" under body care, and "Utensilios de limpieza y
  calzado" under cleaning. Deza has BAZAR sections (Papelería, Textil hogar, Textil
  persona, Bricolaje ferretería, Camping piscina, Disfraces, Bazar) and KIOSCO.

### Target state

New leaves under existing roots:

| Root | Slug | Español | English |
| --- | --- | --- | --- |
| `hair-and-perfumery` | `hair-accessories` | Accesorios para el cabello | Hair accessories |
| `cleaning-and-home` | `shoe-care` | Cuidado del calzado | Shoe care |
| `pets` | `bird-food-and-care` | Pájaros | Birds |
| `pets` | `small-animal-food-and-care` | Roedores y conejos | Rodents and rabbits |
| `pets` | `fish-and-reptile-care` | Peces y reptiles | Fish and reptiles |
| `pets` | `pet-accessories` | Accesorios para mascotas | Pet accessories |
| `beers-wines-and-spirits` | `sherry-and-fortified-wines` | Vinos generosos y dulces | Sherry and fortified wines |
| `beers-wines-and-spirits` | `premixed-drinks` | Combinados y bebidas con alcohol | Premixed drinks |

New roots:

| Root | Leaf slug | Español | English |
| --- | --- | --- | --- |
| `makeup` (Maquillaje, Make-up) | `face-makeup` | Bases y correctores | Foundations and concealers |
| | `powders-and-blush` | Polvos y colorete | Powders and blush |
| | `eye-makeup` | Ojos | Eyes |
| | `lip-makeup` | Labios | Lips |
| | `nail-care` | Manicura y pedicura | Nails |
| | `makeup-tools` | Brochas y accesorios | Brushes and tools |
| `home-and-garden` (Hogar y jardín, Home and garden) | `home-textiles` | Textil hogar | Home textiles |
| | `home-decor` | Decoración | Home decor |
| | `storage-and-organisation` | Orden y almacenaje | Storage and organisation |
| | `garden-and-plants` | Jardín y plantas | Garden and plants |
| | `diy-and-hardware` | Bricolaje y ferretería | DIY and hardware |
| | `lighting-and-electrical` | Iluminación y electricidad | Lighting and electrical |
| | `small-appliances` | Pequeño electrodoméstico | Small appliances |
| | `car-care` | Cuidado del coche | Car care |
| `leisure-and-stationery` (Ocio y papelería, Leisure and stationery) | `stationery-and-school` | Papelería y material escolar | Stationery and school |
| | `books` | Libros | Books |
| | `magazines-and-collectibles` | Revistas y coleccionables | Magazines and collectibles |
| | `toys-and-games` | Juguetes y juegos | Toys and games |
| | `party-and-celebrations` | Fiestas y disfraces | Party and costumes |
| | `beach-and-pool` | Playa y piscina | Beach and pool |
| `clothing-and-accessories` (Ropa y complementos, Clothing and accessories) | `clothing` | Ropa | Clothing |
| | `clothing-accessories` | Complementos | Accessories |

- One migration adds these rows. It moves no product and renames no slug. `down` removes
  only these rows, and refuses when a product or a section points at one of them.
- Mercadona's and LIDL's `category-leaves.ts` map the matching chain sections onto the new
  leaves (Mercadona "Maquillaje" onto the make-up leaves, "Manicura y pedicura" onto
  `nail-care`, and so on).
- The fixtures that are slices of the tree gain only what their own specs need.
- The curation prompt needs no change: it reads the leaf list from the tree at start.

### Scope

Work only in catalog's migrations and the tree export, the chain libraries'
`category-leaves.ts`, the category fixtures, and the specs that pin the leaf count.

Do NOT touch: existing slugs and names, `ROOT_REMAP`, `LEAF_REMAP`, products, sections,
velista and admin code.

### Constraints

- Names are written in Spanish and English, in the same style as DIA's names.
- A spec that undoes "the last migration" breaks when a migration is added. Undo by index.
- Only make changes directly requested.

### Acceptance criteria

- [ ] The migration runs up and down on a database that holds the DIA tree, and `down`
      refuses while a product points at a new leaf.
- [ ] A spec counts 29 + 4 roots and 246 + 30 leaves.
- [ ] Mercadona's "Maquillaje > Labios" section maps to `lip-makeup`.
- [ ] `nx affected -t lint test` is green.

### Action boundaries

Proceed with in-scope edits and tests. Stop and ask before renaming or removing any
existing category.

### Progress evidence

Report the migration only with its up and down spec output.

## The data a person runs after this lands

These are curation runs, not code:

1. Re-file the make-up products from `facial-care` onto the make-up leaves.
2. Decide again the Deza rows the driver skipped as `SECTION_NO_CATEGORY`, and the rows
   in review with `NO_CATEGORY`.
3. Re-file the 31 products under `uncategorised`. Every one of them has a home in this
   tree:

| Products | Leaf |
| --- | --- |
| 10 books ("Libro Altitud", "Libro Arderá el viento" and others) | `books` |
| 3 Burda magazines, 6 collectibles ("Coleccionable Crochet Susimiu" and others) | `magazines-and-collectibles` |
| "Balón de cuero sintético", "Pompero" (Bob Esponja), "Ventilador manual cangrejo" | `toys-and-games` |
| 3 "Portatodo" pencil cases | `stationery-and-school` |
| "Panel mandala árbol de la vida", "Gnomo músico", "Campana de viento de exterior mariposa", "Reloj de pared Basten", "Despertador Abdul" | `home-decor` |
| "Birrete de graduación" | `party-and-celebrations` |
