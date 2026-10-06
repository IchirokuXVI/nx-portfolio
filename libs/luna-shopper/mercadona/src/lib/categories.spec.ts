import categoryExpanded from './__fixtures__/category-expanded.json';
import capsules from './__fixtures__/product-capsules-per-unit.json';
import english from './__fixtures__/product-detail-en.json';
import oliveOil from './__fixtures__/product-detail-es.json';
import inconsistent from './__fixtures__/product-inconsistent-bulk-price.json';
import noEan from './__fixtures__/product-no-ean.json';
import referenceFormat from './__fixtures__/product-reference-format-100ml.json';
import sizeFormatM from './__fixtures__/product-size-format-m.json';
import {
  MERCADONA_CATEGORY_TABLE,
  mercadonaCategorySlugs,
  resolveCategory,
} from './categories';
import { CATEGORY_LEAF_SLUGS, CATEGORY_LEAVES } from './category-leaves';
import { normalizeCategoryProducts, normalizeProduct } from './normalize';

/** A path of bare names, which is what the harvester stores and resolves. */
const names = (...path: string[]) => path.map((name) => ({ name }));

describe('the leaves this library holds a copy of (plans 0173 and 0179)', () => {
  it('has the 29 + 4 roots and their 246 + 30 leaves, uncategorised among them', () => {
    expect(Object.keys(CATEGORY_LEAVES)).toHaveLength(29 + 4);
    expect(CATEGORY_LEAF_SLUGS.size).toBe(246 + 30);
    for (const [root, leaves] of Object.entries(CATEGORY_LEAVES)) {
      expect(leaves.length).toBeGreaterThan(0);
      // A root is never a leaf: a product only ever sits on a child.
      expect(CATEGORY_LEAF_SLUGS.has(root)).toBe(false);
    }
    // The tree has no catch all under a root: this is the only one.
    expect(CATEGORY_LEAVES['other']).toEqual(['uncategorised']);
  });

  it('holds each slug once, as ascii kebab case', () => {
    const all = Object.values(CATEGORY_LEAVES).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const slug of all) {
      expect(slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('answers nothing that is not a leaf, so a typo in the table fails here', () => {
    const unknown = mercadonaCategorySlugs().filter(
      (slug) => !CATEGORY_LEAF_SLUGS.has(slug)
    );
    expect(unknown).toEqual([]);
  });
});

describe('resolveCategory', () => {
  it.each(
    MERCADONA_CATEGORY_TABLE.map((section) => [section.name, section.slug])
  )('lands section %s on %s when no child below it is listed', (name, slug) => {
    expect(resolveCategory(names(name))).toBe(slug);
    expect(resolveCategory(names(name, 'Un pasillo que no existe'))).toBe(slug);
  });

  it('reads every listed child under its own section', () => {
    for (const section of MERCADONA_CATEGORY_TABLE) {
      for (const [child, slug] of section.children) {
        expect(resolveCategory(names(section.name, child))).toBe(slug);
      }
    }
  });

  it('splits Aceite, especias y salsas by its children rather than filing it whole', () => {
    const section = 'Aceite, especias y salsas';
    expect(resolveCategory(names(section, 'Aceite, vinagre y sal'))).toBe(
      'oils'
    );
    expect(resolveCategory(names(section, 'Especias'))).toBe(
      'spices-and-herbs'
    );
    expect(resolveCategory(names(section, 'Otras salsas'))).toBe(
      'special-and-spicy-sauces'
    );
  });

  it('reads a reused child name under the section above it, not a flat map', () => {
    // `Marisco`, `Verdura` and `Pizzas` exist in two sections each, and in
    // `Congelados` each one is the frozen aisle.
    expect(resolveCategory(names('Marisco y pescado', 'Marisco'))).toBe(
      'seafood-shrimp-and-squid'
    );
    expect(resolveCategory(names('Congelados', 'Marisco'))).toBe(
      'frozen-foods-and-ice-cream-fish-and-seafood'
    );
    expect(resolveCategory(names('Fruta y verdura', 'Verdura'))).toBe(
      'uncategorised'
    );
    expect(resolveCategory(names('Congelados', 'Verdura'))).toBe(
      'vegetables-and-potatoes'
    );
    expect(resolveCategory(names('Pizzas y platos preparados', 'Pizzas'))).toBe(
      'refrigerated-pizzas'
    );
    expect(resolveCategory(names('Congelados', 'Pizzas'))).toBe(
      'pizzas-and-doughs'
    );
    // `Carne` is a section and a child of `Congelados`: the deepest node is
    // read under its section first.
    expect(resolveCategory(names('Congelados', 'Carne'))).toBe('uncategorised');
    expect(resolveCategory(names('Carne', 'Vacuno'))).toBe('beef');
    // Both sections above answer `uncategorised`, so that line alone cannot
    // tell the two readings apart. Under the one section that is a leaf it
    // can: read as a section, `Carne` would answer `uncategorised` here.
    expect(resolveCategory(names('Fitoterapia y parafarmacia', 'Carne'))).toBe(
      'parapharmacy'
    );
  });

  it('files make-up on the leaves plan 0179 added, and nails with them', () => {
    expect(resolveCategory(names('Maquillaje', 'Labios'))).toBe('lip-makeup');
    expect(resolveCategory(names('Maquillaje', 'Ojos'))).toBe('eye-makeup');
    expect(
      resolveCategory(names('Maquillaje', 'Bases de maquillaje y corrector'))
    ).toBe('face-makeup');
    expect(resolveCategory(names('Maquillaje', 'Colorete y polvos'))).toBe(
      'powders-and-blush'
    );
    // Mercadona files nails under body care, and the leaf is a make-up one.
    expect(
      resolveCategory(names('Cuidado facial y corporal', 'Manicura y pedicura'))
    ).toBe('nail-care');
    // The section spans every make-up leaf, so alone it names none of them.
    expect(resolveCategory(names('Maquillaje'))).toBe('uncategorised');
    expect(resolveCategory(names('Maquillaje', 'Un pasillo nuevo'))).toBe(
      'uncategorised'
    );
  });

  it('climbs past a third level node nobody mapped', () => {
    // A walk's path is section, child, then the level the expanded response
    // nests products under. That level is not in the table.
    expect(
      resolveCategory(
        names(
          'Aceite, especias y salsas',
          'Aceite, vinagre y sal',
          'Aceite de oliva'
        )
      )
    ).toBe('oils');
  });

  describe('the cheese override (plan 0038, section 5.6)', () => {
    it('sends the three cheese ids of Charcutería to one cheese leaf, whatever they are called', () => {
      for (const id of [53, 54, 56]) {
        expect(
          resolveCategory([
            { id: 51, name: 'Charcutería y quesos' },
            { id, name: 'Un nombre nuevo' },
          ])
        ).toBe('semi-cured');
      }
    });

    it('sends cheese there from bare names too, which is what the harvester stores', () => {
      // The harvester resolves the stored path, which keeps names and no ids.
      // Under the old table this path landed in MEAT.
      expect(
        resolveCategory(
          names('Charcutería y quesos', 'Queso curado, semicurado y tierno')
        )
      ).toBe('semi-cured');
      expect(resolveCategory(names('Charcutería y quesos', 'Queso'))).toBe(
        'semi-cured'
      );
    });

    it('reaches each cheese child its own leaf by name', () => {
      // The override answers one slug, and none of its names is a child the
      // table lists, so a bare name still lands on that child's leaf.
      expect(
        resolveCategory(
          names('Charcutería y quesos', 'Queso lonchas, rallado y en porciones')
        )
      ).toBe('sliced');
      expect(
        resolveCategory(names('Charcutería y quesos', 'Queso untable y fresco'))
      ).toBe('cheeses-fresh');
    });

    it('leaves the rest of Charcutería on the cold cuts leaves', () => {
      expect(
        resolveCategory([
          { id: 51, name: 'Charcutería y quesos' },
          { id: 55, name: 'Jamón serrano' },
        ])
      ).toBe('serrano-ham');
      expect(resolveCategory(names('Charcutería y quesos'))).toBe(
        'uncategorised'
      );
    });
  });

  it('answers null for a path that names no section', () => {
    expect(resolveCategory(names('Sección que no existe'))).toBeNull();
    expect(
      resolveCategory(names('Sección que no existe', 'Verdura'))
    ).toBeNull();
    expect(resolveCategory([])).toBeNull();
  });

  it('ignores case and accents, which the source does not keep stable', () => {
    expect(resolveCategory(names('FRUTA Y VERDURA', 'fruta'))).toBe(
      'other-fruits'
    );
    expect(
      resolveCategory(names('panaderia y pasteleria', 'bolleria de horno'))
    ).toBe('sweet-baked-goods');
  });
});

describe('the checked in fixtures (plan 0166, section 7)', () => {
  /**
   * Every product the fixtures hold that the harvester would resolve: the
   * Spanish detail payloads, and the category listing with the path the walk
   * gives it. Each is resolved twice, once as normalized and once from bare
   * names, because the harvester reads the stored path and the stored path has
   * no ids.
   */
  const spanish = [
    oliveOil,
    capsules,
    inconsistent,
    noEan,
    referenceFormat,
    sizeFormatM,
  ].map((raw) => normalizeProduct(raw));
  const listed = normalizeCategoryProducts(categoryExpanded);

  it('lands every one of them on a leaf, none on null', () => {
    expect(spanish.map((product) => product.categorySlug)).toEqual([
      'oils',
      'compatible-nespresso-capsules',
      'serrano-ham',
      'batteries-kitchenware-and-bags',
      'body-and-hand-hydration',
      'film-aluminum-and-preservation',
    ]);
    expect(
      spanish.map((product) => resolveCategory(names(...product.categoryPath)))
    ).toEqual(spanish.map((product) => product.categorySlug));

    expect(
      listed.map((product) => resolveCategory(product.categoryPath))
    ).toEqual(['semi-cured', 'serrano-ham', 'serrano-ham']);
    expect(
      listed.map((product) =>
        resolveCategory(names(...product.categoryPath.map((node) => node.name)))
      )
    ).toEqual(['semi-cured', 'serrano-ham', 'serrano-ham']);
  });

  it('answers null for the English payload, whose tree the table is not keyed on', () => {
    // The English detail is fetched for its name only (plan 0038, section 6.2).
    // A walk reads the Spanish tree, so no production path resolves this one,
    // and the table deliberately holds no English names.
    expect(normalizeProduct(english).categorySlug).toBeNull();
  });
});
