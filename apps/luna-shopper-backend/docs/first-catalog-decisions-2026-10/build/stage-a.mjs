// Stage A of backend plan 0186: steps A1 to A11.
import {
  J,
  firstUuid,
  mdTables,
  product,
  firstKnown,
  row,
  startGaps,
  writeData,
} from './lib.mjs';

const KEYS_A =
  'Each product is keyed as it stood in the catalog of 2026-10-03, before stage A. ' +
  'That state is replayed from the end of stage A (see build/state.mjs).';
const DELEGATED =
  'the directing session, on the word of the owner of 2026-10-06 ("Decide for yourself on the rest, they seem fine")';

export function stageA({ beforeA, rows }) {
  const out = [];
  const P = (id) => product(id, beforeA.get(id));
  const R = (id, seen) => row(id, firstKnown(rows.get(id), seen));
  const byId = (tables, column) => {
    const map = new Map();
    for (const t of tables)
      for (const r of t.rows) {
        const id = firstUuid(r[column]);
        if (id) map.set(id, { ...r, section: t.section });
      }
    return map;
  };

  // ---- A1 -----------------------------------------------------------------------------
  {
    startGaps();
    const md = byId(mdTables('proposals/A1-english-names.md'), 'Product');
    const sent = new Set(
      J('pass2/pass2-a1.answers.json').items.map((i) => i.itemId)
    );
    const entries = J('proposals/A1.answers.json').items.map((i) => ({
      product: P(i.itemId),
      decision: { action: 'set-english-name', nameEn: i.name.en },
      sure: i._sure,
      status: sent.has(i.itemId)
        ? 'applied'
        : 'left for a person, the name is a proposal only',
      ...(sent.has(i.itemId) ? {} : { openDecision: 8 }),
      evidence: md.get(i.itemId)?.Evidence ?? null,
    }));
    out.push(
      writeData(
        'a01-english-names.json',
        {
          step: 'A1',
          title: 'An English name for each product that had none',
          sources: [
            'proposals/A1.answers.json',
            'proposals/A1-english-names.md',
            'pass2/pass2-a1.answers.json',
          ],
          keys: KEYS_A,
          decidedBy: `An agent wrote the names. Applied by ${DELEGATED}: every name marked high or medium.`,
          note: 'The batch sent both languages. nameEs of the product is the Spanish name that was sent again unchanged.',
        },
        entries
      )
    );
  }

  // ---- A2 -----------------------------------------------------------------------------
  {
    startGaps();
    const entries = J('a2.answers.json').items.map((i) => ({
      product: P(i.itemId),
      decision: { action: 'clear-pack-count', packCountWas: i._was },
      status: 'applied',
      why: 'The pack count is the first number of a dimension in the name.',
      printedRows: i._queueRows,
    }));
    out.push(
      writeData(
        'a02-pack-counts-from-a-dimension.json',
        {
          step: 'A2',
          title: 'A pack count read from a dimension',
          sources: ['a2.answers.json'],
          keys: KEYS_A,
          decidedBy: 'Plan 0186, target A2.',
        },
        entries
      )
    );
  }

  // ---- A3 -----------------------------------------------------------------------------
  {
    startGaps();
    const a3 = J('a3.answers.json');
    const openOf = (id) => {
      const es = beforeA.get(id)?.es ?? '';
      if (/^A volume of content, not a liquid/.test(reading.get(id) ?? ''))
        return { openDecision: 13 };
      if (es === 'Jamón serrano pieza') return { openDecision: 14 };
      return {};
    };
    const reading = new Map(a3.items.map((i) => [i.itemId, i._reading]));
    const entries = a3.items.map((i) => ({
      product: P(i.itemId),
      decision: {
        action: 'set-unit',
        size: i.unitSize ?? null,
        unit: i.defaultUnit,
      },
      status: 'applied in pass 1',
      why: i._reading,
      ...openOf(i.itemId),
    }));
    const caps = new Map(
      J('pass2/pass2-a3.answers.json').items.map((i) => [i.itemId, i])
    );
    const pieces = new Map(
      J('stage-b/b1-three-pieces.answers.json').items.map((i) => [i.itemId, i])
    );
    for (const l of a3.leftForAPerson) {
      const c = caps.get(l.itemId);
      const p = pieces.get(l.itemId);
      entries.push({
        product: P(l.itemId),
        decision: c
          ? {
              action: 'capacity-into-the-name',
              nameEs: c.name.es,
              nameEn: c.name.en,
              size: null,
              unit: 'UNIT',
            }
          : { action: 'set-unit', size: null, unit: 'KILOGRAM' },
        status: c
          ? 'left in pass 1, applied in pass 2'
          : 'left in stage A, applied in stage B (step B1)',
        why: c
          ? 'Only the capacity tells this product from its pair. The owner decided on 2026-10-06 that the capacity goes in the name.'
          : 'After the Mercadona run of stage B the row says it is sold by weight and sends no size.',
        readingOfPass1: l.reason,
        printedRows: c?._row ?? p?._row ?? l.rows,
      });
    }
    out.push(
      writeData(
        'a03-units.json',
        {
          step: 'A3',
          title: 'A sized KILOGRAM and every LITER',
          sources: [
            'a3.answers.json',
            'a3.read.json',
            'pass2/pass2-a3.answers.json',
            'stage-b/b1-three-pieces.answers.json',
          ],
          keys: KEYS_A,
          decidedBy:
            'Plan 0186, target A3. An agent read which products are a weight, a volume or a capacity. The owner decided the two capacity pairs on 2026-10-06.',
          counts: a3.counts,
        },
        entries
      )
    );
  }

  // ---- A4 -----------------------------------------------------------------------------
  {
    startGaps();
    const a4 = J('a4.answers.json');
    const entries = a4.items.map((i) => ({
      product: P(i.itemId),
      decision: i.ean
        ? { action: 'pad-code', code: i.ean }
        : { action: 'clear-code' },
      status: 'applied',
      why: i._rule,
      codesOnTheQueueRows: i._queueRowEans,
    }));
    for (const l of a4.leftForAPerson)
      entries.push({
        product: P(l.itemId),
        decision: { action: 'none' },
        status: 'left for a person',
        why: l.reason,
        validCheckDigit: l.validCheckDigit,
      });
    out.push(
      writeData(
        'a04-codes-that-are-not-a-barcode.json',
        {
          step: 'A4',
          title: 'An in-store or invalid code as the barcode of a product',
          sources: ['a4.answers.json'],
          keys:
            KEYS_A +
            ' The barcode of each product is the code this step judged, so it is the code before the change.',
          decidedBy: 'Plan 0186, target A4.',
          counts: a4.counts,
        },
        entries
      )
    );
  }

  // ---- A5 -----------------------------------------------------------------------------
  {
    startGaps();
    const notApplied = {
      'c1067291-32f0-4bd9-812c-ac26bbb15212': {
        status: 'not applied',
        openDecision: 15,
        whyNot:
          'The Mercadona row b0e4e422 prints 1.5 as its size, beside a unit price that says 1.25 L. The instruction was to leave the row when it prints 1.5 L.',
      },
      '7541e849-c084-412d-90a4-26bbf5376953': {
        status: 'not applied',
        openDecision: 10,
        whyNot:
          'A create from row 67a821e4 leaves the 2.95 price row on the old product, and removing it is a delete the pass was not given. A person must also say whether the pack is 240 g (printed) or 260 g (unit price).',
      },
    };
    const groups = new Map(
      J('proposals/A5.answers.json').left.map((l) => [l.itemId, l.group])
    );
    const entries = [];
    for (const t of mdTables('proposals/A5-sizes-against-unit-prices.md'))
      for (const r of t.rows) {
        const id = firstUuid(r.Product);
        if (!id) continue;
        const applied = id === '9810360f-aeb1-4101-8d41-d75a8a2cf5ec';
        entries.push({
          product: P(id),
          verdict: t.section,
          group: groups.get(id) ?? null,
          decision: applied
            ? { action: 'set-size', size: 160, unit: 'GRAM' }
            : { action: 'none' },
          ...(applied
            ? { status: 'applied in pass 2' }
            : (notApplied[id] ?? { status: 'left' })),
          priceRowSays: r['Price row says'],
          printedRows: r['Queue row of that chain'],
          proposal: r.Proposal,
          why: r.Reason,
          sure: r['How sure'],
        });
      }
    out.push(
      writeData(
        'a05-sizes-against-unit-prices.json',
        {
          step: 'A5',
          title: 'A size that the unit price contradicts',
          sources: [
            'proposals/A5-sizes-against-unit-prices.md',
            'proposals/A5.answers.json',
            'pass2/pass2-a5.answers.json',
            'stage-a-summary.md',
          ],
          keys: KEYS_A,
          decidedBy: `An agent read every case. Applied by ${DELEGATED}: the one correction the plan names.`,
        },
        entries
      )
    );
  }

  // ---- A6 -----------------------------------------------------------------------------
  {
    startGaps();
    const tables = mdTables('proposals/A6-pairs.md').filter((t) =>
      ['Exact pairs left', 'Near pairs'].includes(t.section)
    );
    const proposal = new Map();
    for (const t of tables)
      for (const r of t.rows)
        proposal.set(
          firstUuid(r['One product']) + firstUuid(r['The other product']),
          { ...r, section: t.section }
        );
    const entries = [];
    const merge = (r, pass, kind, cascaded) => {
      const p = proposal.get(r.kept + r.gone) ?? proposal.get(r.gone + r.kept);
      entries.push({
        decision: 'merge',
        kind,
        kept: P(r.kept),
        deleted: P(r.gone),
        rowsMoved: r.accepts.map((a) => R(a.entryId, { name: a.name })),
        priceRowsCascaded: cascaded,
        status: `applied in pass ${pass}`,
        why: (p?.Reason ?? 'The same brand, name, size, unit and pack count.').split(' Not merged in this pass')[0],
        sure: p?.['How sure'] ?? null,
      });
    };
    for (const r of J('a6-exact.result.json').report) merge(r, 1, 'exact', 0);
    for (const f of ['exact', 'near'])
      for (const r of J(`pass2/pass2-a6-${f}.result.json`).report)
        merge(r, 2, f, r.cascadedPriceRows.length);
    const rename = J('pass2/pass2-a6-near-rename-fix.answers.json').items[0];
    entries.push({
      decision: 'rename',
      product: P(rename.itemId),
      nameEs: rename.name.es,
      nameEn: rename.name.en,
      status: 'applied in pass 2, after the merge of the YoPro pair',
      why: 'The name the October owner fix gave. The first call sent only the Spanish name and lost the English one. A second call put it back.',
    });
    for (const p of proposal.values()) {
      if (p.Verdict === 'MERGE') continue;
      const fruit = p.Verdict === 'A PERSON DECIDES';
      entries.push({
        decision: 'no merge',
        verdict: p.Verdict.toLowerCase(),
        a: P(firstUuid(p['One product'])),
        b: P(firstUuid(p['The other product'])),
        status: fruit ? 'left for a person' : 'left, two products',
        ...(fruit ? { openDecision: 11 } : {}),
        proposal: p.Proposal,
        why: p.Reason,
        sure: p['How sure'],
      });
    }
    out.push(
      writeData(
        'a06-the-same-product-twice.json',
        {
          step: 'A6',
          title: 'The same product twice',
          sources: [
            'a6-exact.result.json',
            'a6.read.json',
            'pass2/pass2-a6-exact.result.json',
            'pass2/pass2-a6-near.result.json',
            'pass2/pass2-a6-near-rename-fix.answers.json',
            'proposals/A6-pairs.md',
          ],
          keys: KEYS_A,
          decidedBy: `Exact pairs: plan 0186, target A6. The cascade of a price row: the owner, 2026-10-06. Near pairs: an agent proposed them, applied by ${DELEGATED}.`,
          notApplied: [
            'The rename the proposal gives the Nivea Men roll-on 8e3b0d5e ("Desodorante roll-on Men invisible Black & White antitranspirante"). The pair stays two products with one name.',
            'The remark that "Agua mineral natural mineralización débil" is the better name for the kept Fuente Liviana 2 L product. It is still named "Agua mineral".',
          ],
          notInThisFile:
            'The 729 other candidates of the near read, all read as two products. They are the last table of proposals/A6-pairs.md and are not copied here.',
        },
        entries
      )
    );
  }

  // ---- A7 -----------------------------------------------------------------------------
  {
    startGaps();
    const a7 = J('a7.result.json');
    const h = J('pass2/pass2-h.result.json');
    const k = a7.kitkat;
    const s = a7.skewers;
    const entries = [
      {
        decision: 'rebind',
        row: R(k.before.row.id, k.before.row),
        from: P(k.before.figurine.id),
        to: P(k.before.bars.id),
        status: 'applied in pass 1',
        then: {
          action: 'delete-stale-price-row',
          priceRow: {
            chain: h.before.chain,
            sourceKind: h.before.row.sourceKind,
            price: h.before.row.price,
            unitPrice: h.before.row.unitPrice,
            localId: h.before.row.id,
          },
          status: 'applied in pass 2 (step h)',
          why: 'An accept writes the price on the new product and leaves the old row. The bars product held the same price in the same scope.',
        },
        stillOpen:
          'The figurine shows as available in 20 El Jamón scopes with no price.',
        openDecision: 16,
      },
      {
        decision: 'split',
        product: P(s.before.product.id),
        renamedTo: s.renamed,
        newProduct: {
          nameEs: s.created.name.es,
          nameEn: s.created.name.en,
          size: s.created.unitSize,
          unit: s.created.defaultUnit,
          localId: s.created.id,
        },
        rowThatStays: R(s.before.row20.id, s.before.row20),
        rowThatMoves: R(s.before.row325.id, s.before.row325),
        status: 'applied in pass 1',
        why: 'The 20 cm and the 32.5 cm skewers are two products. The length goes in the name.',
      },
      {
        decision: 'none',
        product: P(a7.pepsi.product.id),
        rows: a7.pepsi.rows.map((r) => R(r.id, r)),
        status: 'no change',
        why: a7.pepsi.note,
      },
    ];
    out.push(
      writeData(
        'a07-rows-bound-to-the-wrong-product.json',
        {
          step: 'A7',
          title: 'A row bound to the wrong product',
          sources: ['a7.result.json', 'pass2/pass2-h.result.json'],
          keys: KEYS_A,
          decidedBy: `Plan 0186, target A7. The delete of the stale price row: ${DELEGATED}, only through a gateway route.`,
        },
        entries
      )
    );
  }

  // ---- A8 -----------------------------------------------------------------------------
  {
    startGaps();
    const a8 = J('a8.result.json');
    const entries = a8.linked.map((l) => ({
      decision: 'link',
      spelling: { label: l.spelling, localId: l.spellingId },
      brand: { label: l.brand, localId: l.brandId },
      movedItems: l.movedItems,
      productsMoved: l.products.map((p) => P(p.id)),
      status: 'applied in pass 1',
    }));
    for (const n of a8.notLinked)
      entries.push({
        decision: 'no link',
        spelling: { key: n.spelling, label: 'Gotitas de Oro' },
        brand: { key: n.brand, label: 'Gotas de Oro' },
        status: 'not linked',
        why: n.reason,
      });
    out.push(
      writeData(
        'a08-one-brand-registered-twice.json',
        {
          step: 'A8',
          title: 'One brand registered twice',
          sources: ['a8.result.json'],
          keys: KEYS_A + ' A brand is keyed by its label.',
          decidedBy: `Plan 0186, target A8. Gotitas de Oro stays unlinked: an agent read both brands, and ${DELEGATED} kept it.`,
        },
        entries
      )
    );
  }

  // ---- A9 -----------------------------------------------------------------------------
  {
    startGaps();
    const md = byId(mdTables('proposals/A9-wrong-brands.md'), 'Product now');
    const prop = J('proposals/A9.answers.json');
    const entries = J('pass2/pass2-a9.answers.json').items.map((i) => ({
      decision: 'rename',
      product: P(i.itemId),
      ...(i.brand ? { brand: i.brand } : {}),
      nameEs: i.name.es,
      nameEn: i.name.en,
      namedByThePlan: i._namedByThePlan ?? null,
      status: 'applied in pass 2',
      why: md.get(i.itemId)?.Reason ?? null,
      sure: i._sure,
    }));
    for (const r of J('pass2/pass2-a9-merge.result.json').report)
      entries.push({
        decision: 'merge',
        kind: r.kind,
        kept: P(r.kept),
        deleted: P(r.gone),
        rowsMoved: r.accepts.map((a) => R(a.entryId, { name: a.name })),
        priceRowsCascaded: r.cascadedPriceRows.length,
        status: 'applied in pass 2',
        why: md.get(r.gone)?.Reason ?? null,
        sure: md.get(r.gone)?.['How sure'] ?? null,
      });
    for (const n of prop.notChanged)
      entries.push({
        decision: 'none',
        product: P(n.itemId),
        status: 'no change',
        why: n.why,
      });
    out.push(
      writeData(
        'a09-a-wrong-brand-on-a-product.json',
        {
          step: 'A9',
          title: 'A wrong brand on a product',
          sources: [
            'proposals/A9.answers.json',
            'proposals/A9-wrong-brands.md',
            'pass2/pass2-a9.answers.json',
            'pass2/pass2-a9-merge.result.json',
          ],
          keys: KEYS_A,
          decidedBy: `Plan 0186, target A9, for the products the plan names. An agent found two more. Applied by ${DELEGATED}.`,
        },
        entries
      )
    );
  }

  // ---- A10 ----------------------------------------------------------------------------
  {
    startGaps();
    const tables = mdTables('proposals/A10-names-that-say-pack.md');
    const md = byId(tables, 'Product');
    const entries = J('pass2/pass2-a10.answers.json').items.map((i) => ({
      decision: 'rename',
      product: P(i.itemId),
      nameEs: i.name.es,
      nameEn: i.name.en,
      status: 'applied in pass 2',
      whatAlreadySaysIt: md.get(i.itemId)?.['What already says it'] ?? null,
      sure: i._sure,
    }));
    for (const t of tables.filter((x) => x.section === 'Left out'))
      for (const r of t.rows)
        entries.push({
          decision: 'none',
          product: P(firstUuid(r.Product)),
          status: 'left out',
          why: r.Reason,
          printedRows: r['Queue rows'],
        });
    out.push(
      writeData(
        'a10-names-that-say-pack.json',
        {
          step: 'A10',
          title: 'A name that says "pack"',
          sources: [
            'proposals/A10.answers.json',
            'proposals/A10-names-that-say-pack.md',
            'pass2/pass2-a10.answers.json',
          ],
          keys: KEYS_A,
          decidedBy: `Plan 0186, target A10. An agent wrote the names. Applied by ${DELEGATED}.`,
        },
        entries
      )
    );
  }

  // ---- A11 ----------------------------------------------------------------------------
  {
    startGaps();
    const agentJudged = [
      'Oral-B 3D White',
      'Oral-B Pro-Expert',
      'Oral-B Pro-Flex',
      'Vanish Oxi Action',
      'Norit Complet',
    ];
    const brandOf = (b) => ({ label: b.label, key: b.key, localId: b.id });
    const entries = [];
    for (const op of J('pass2/pass2-j-brands.result.json').report) {
      if (op.kind === 'rename') {
        entries.push({
          decision: 'rename-brand',
          brand: brandOf(op.before),
          newLabel: op.answer.label,
          newKey: op.answer.key,
          productsUnderTheBrand: op.before.products,
          status: 'applied',
        });
        continue;
      }
      const refused = op.status !== 200;
      entries.push({
        decision: 'link',
        spelling: brandOf(op.before.line),
        brand: brandOf(op.before.house),
        ...(refused
          ? {
              status: `refused, ${op.refused}`,
              why: op.answer.message,
              openDecision: 12,
            }
          : { status: 'applied', movedItems: op.answer.movedItems }),
        productsMoved: refused ? [] : op.moving.map((p) => P(p.id)),
        decidedBy: agentJudged.includes(op.line)
          ? 'agent judgement, the owner may change it'
          : 'the proposal column of section 1 of plan 0186',
        ...(agentJudged.includes(op.line) ? { openDecision: 12 } : {}),
      });
    }
    for (const f of ['j-items', 'j-invictus'])
      for (const i of J(`pass2/pass2-${f}.answers.json`).items)
        entries.push({
          decision: 'rename',
          product:
            f === 'j-invictus'
              ? { ...P(i.itemId), note: 'second write on this product' }
              : P(i.itemId),
          ...(i.brand ? { brand: i.brand } : {}),
          nameEs: i.name.es,
          nameEn: i.name.en,
          status: 'applied',
          why:
            i._why ??
            'The link Invictus to Paco Rabanne was refused, so the one product moved to the house through its own brand field.',
        });
    const full = (short) =>
      [...beforeA.keys()].find((id) => id.startsWith(short));
    for (const [a, b, why] of [
      [
        'ab6ee2c7',
        '78b23b26',
        'Johnnie Walker Black Label, 700 ml, from Mercadona and from Deza and El Jamón.',
      ],
      [
        '101efa7b',
        '438c9786',
        "Dewar's White Label, 700 ml, from El Jamón and from Deza.",
      ],
      [
        'eb12448c',
        '468813f6',
        "Dewar's White Label, 1 L, from El Jamón and from Deza.",
      ],
      [
        'a654a2ce',
        'd38b02dd',
        'ProActiv margarine, 225 g, at 3.19. The second product still stands under Flora.',
      ],
    ])
      entries.push({
        decision: 'no merge',
        a: P(full(a)),
        b: P(full(b)),
        status: 'left, probably one product stored twice',
        openDecision: 9,
        why: `Made visible by the brand links. ${why} No merge was named for the pair, so none was made.`,
      });
    out.push(
      writeData(
        'a11-brand-decisions.json',
        {
          step: 'A11',
          title: 'The brand questions of section 1 of plan 0186',
          sources: [
            'pass2/pass2-j-brands.plan.json',
            'pass2/pass2-j-brands.result.json',
            'pass2/pass2-j-items.answers.json',
            'pass2/pass2-j-invictus.answers.json',
            'stage-a-summary.md',
          ],
          keys: KEYS_A + ' A brand is keyed by its label and its key.',
          decidedBy: `The proposal column of section 1 of plan 0186, applied by ${DELEGATED}. The owner answered no row of section 1 one by one. Five links are the judgement of an agent and are marked.`,
          order:
            'The product renames were sent before the links, so that the word was in the name when the brand became a spelling.',
          linesLeftSeparate: [
            {
              brand: 'Nike Ultra Blue',
              products: 1,
              why: '"Ultra Blue" is the name of a fragrance, not who it is for.',
            },
            {
              brand: 'Vileda Turbo',
              products: 2,
              why: 'A product name. The spelling VILEDA TURBO SMART points at it, so a link would be refused.',
            },
            { brand: 'Vileda Duactiva', products: 1, why: 'A product name.' },
            {
              brand: 'Nescafé Farmers Origins',
              products: 3,
              why: 'A capsule range that may have its own shelf identity. The spelling FARMERS ORIGINS NESCAFÉ points at it, so a link would be refused.',
            },
            {
              brand: 'Puleva Max',
              products: 3,
              why: "A children's line, the same kind as Hero Baby, which stays.",
            },
            {
              brand: 'Neutrex Transpirex',
              products: 1,
              why: 'Reads as the name of one product.',
            },
            {
              brand: 'Lenor Unstoppables',
              products: 1,
              why: 'Reads as the name of one product.',
            },
          ],
          linesLeftSeparateOpenDecision: 12,
          stayByTheProposalOfThePlan: [
            'Kinder Bueno',
            'Kinder Joy',
            'Hero Baby',
            'YoPro',
          ],
          heldOrKept: [
            'Wine labels Cebolla, 409 and Frizz: held, no change.',
            'Excellence: kept.',
            'Flora: not linked to ProActiv, it holds 7 other products.',
            'Licence names and the 178 brands with no product: kept.',
          ],
        },
        entries
      )
    );
  }

  return out;
}
