// Backend plan 0192: the owner's decisions of 2026-10-06, applied on slot 1 in three
// stages. The files of each stage stand in `stage-c1/`, `stage-c2/` and `stage-c3/` of the
// run folder.
//
// A product is keyed as it stood at the start of the stage that changed it. A product that
// a stage created is keyed as the create answered it.
import { ANSWERS_AFTER_THE_REGISTER as LATER } from './decisions.mjs';
import {
  CHAINS,
  J,
  JL,
  itemState,
  product,
  row,
  rowState,
  startGaps,
  writeData,
} from './lib.mjs';

const KEYS_C =
  'Each product is keyed as it stood at the start of the stage of plan 0192 that changed it (the items-snapshot of that stage). A product that a stage created is keyed as the create answered it. Each queue row is keyed as it stood at the start of stage 1 (stage-c1/rows-snapshot.c0-start.json).';
const STAGE_1 = 'applied in stage 1';
const STAGE_2 = 'applied in stage 2';
const STAGE_3 = 'applied in stage 3';

const items = (f) => new Map(J(f).items.map((i) => [i.id, itemState(i)]));
const rowsOf = (f) => new Map(J(f).rows.map((r) => [r.id, r]));

export function stageC() {
  const out = [];
  const i1 = items('stage-c1/items-snapshot.c0-start.json');
  const i2 = items('stage-c2/items-snapshot.s0-start.json');
  const i3 = items('stage-c3/items-snapshot.c0-start.json');
  const r1 = rowsOf('stage-c1/rows-snapshot.c0-start.json');
  const rows2 = [
    rowsOf('stage-c2/rows-snapshot.s0-start.json'),
    rowsOf('stage-c2/rows-snapshot.s3-end-of-stage-2.json'),
  ];
  const rows3 = [
    rowsOf('stage-c3/rows-snapshot.c0-start.json'),
    rowsOf('stage-c3/rows-snapshot.c9-end.json'),
  ];

  const P = (map, id) => product(id, map.get(id));
  const R = (id) => row(id, r1.has(id) ? rowState(r1.get(id)) : null);
  /** A product that a create answered. */
  const created = (c) => ({
    ...product(c.id, {
      brand: c.brand,
      es: c.name.es,
      size: c.unitSize,
      unit: c.defaultUnit,
      pack: c.packCount,
      ean: c.ean,
    }),
    nameEn: c.name.en,
    categories: c.categories.map((x) => x.slug),
  });
  /** The rows that named `gone` before the stage and name `kept` after it. */
  const moved = ([before, after], gone, kept) =>
    [...before.values()]
      .filter((r) => r.itemId === gone && after.get(r.id)?.itemId === kept)
      .map((r) => R(r.id));
  const merge = (snapshots, map, kept, gone, rest) => ({
    decision: 'merge',
    kept: P(map, kept),
    deleted: P(map, gone),
    rowsMoved: moved(snapshots, gone, kept),
    priceRowsCascaded: 0,
    ...rest,
  });

  // ---- C1, decision 8 -----------------------------------------------------------------
  {
    startGaps();
    const entries = J('stage-c1/c1-english-names.answers.json').items.map(
      (i) => ({
        product: P(i1, i.itemId),
        decision: { action: 'set-name', nameEs: i.name.es, nameEn: i.name.en },
        status: STAGE_1,
        openDecision: 8,
        why:
          i.name.es === i.name.en
            ? 'A proper name. It stays as it is in English.'
            : 'The name of the recommendation, not the name that step A1 proposed.',
      })
    );
    out.push(
      writeData(
        'c01-english-names.json',
        {
          step: 'C1',
          title: 'Decision 8: an English name on the four products that had none',
          sources: ['stage-c1/c1-english-names.answers.json'],
          keys: KEYS_C,
          decidedBy: 'The owner, 2026-10-06 (decision 8).',
        },
        entries
      )
    );
  }

  // ---- C2, decision 3 -----------------------------------------------------------------
  {
    startGaps();
    const entries = J('stage-c1/c2-fish.read.json').map((e) => ({
      product: P(i1, e.itemId),
      decision:
        e.decision === 'write'
          ? {
              action: 'set-unit',
              size: Number(e.write.split(' ')[0]),
              unit: 'GRAM',
            }
          : { action: 'none' },
      status: e.decision === 'write' ? STAGE_1 : 'left',
      openDecision: 3,
      ...(e.decision === 'write'
        ? {}
        : { ownerAnswerAfterTheRegister: LATER.paella }),
      why:
        e.decision === 'write'
          ? 'Exactly one round weight lies within 1 percent of price over unit price.'
          : e.why,
      price: e.prices[0].price,
      unitPrice: e.prices[0].unitPrice,
      gramsThatPriceOverUnitPriceGives: e.figures[0],
      roundWeightsWithin1Percent: e.roundWeightsWithin1Percent,
      rows: e.rows.map((r) => R(r.id)),
    }));
    out.push(
      writeData(
        'c02-frozen-fish.json',
        {
          step: 'C2',
          title:
            'Decision 3: a weight in GRAM on the frozen fish that the chain sells as a fixed pack',
          sources: ['stage-c1/c2-fish.read.json', 'stage-c1/c2-fish.answers.json'],
          keys: KEYS_C,
          decidedBy:
            'The owner, 2026-10-06 (decision 3). Plan 0192 reads "a round pack weight" as a multiple of 10 g or of 25 g, and writes a weight only when exactly one lies within 1 percent.',
          note: 'The price and the unit price are those of the first of the three Córdoba warehouses. The three agree on every product.',
        },
        entries
      )
    );
  }

  // ---- C3, decision 14 ----------------------------------------------------------------
  {
    startGaps();
    const entries = J('stage-c1/c3-ham.answers.json').items.map((i) => ({
      product: P(i1, i.itemId),
      decision: { action: 'set-unit', size: null, unit: 'KILOGRAM' },
      status: STAGE_1,
      openDecision: 14,
      why: i._why,
    }));
    out.push(
      writeData(
        'c03-the-ham-piece.json',
        {
          step: 'C3',
          title: 'Decision 14: the Incarlopsa ham piece is sold by the kilo',
          sources: ['stage-c1/c3-ham.answers.json'],
          keys: KEYS_C,
          decidedBy: 'The owner, 2026-10-06 (decision 14).',
        },
        entries
      )
    );
  }

  // ---- C4, decision 12 ----------------------------------------------------------------
  {
    startGaps();
    const brand = (b) => ({ label: b.label, key: b.key, localId: b.id });
    const entries = J('stage-c1/c4-brand-names.answers.json').items.map(
      (i) => ({
        decision: 'rename',
        product: P(i1, i.itemId),
        newNameEs: i.name.es,
        newNameEn: i.name.en,
        line: i._line,
        house: i._house,
        status: STAGE_1,
        openDecision: 12,
        why: 'The word of the line goes into the name before the line joins its house.',
      })
    );
    for (const o of J('stage-c1/c4-brand-spellings.result.json').out)
      entries.push({
        decision: 'link',
        spelling: brand(o.before.child),
        brand: brand(o.before.house),
        pointedAtBefore: brand(o.before.line),
        status: o.status === 200 ? STAGE_1 : `refused, ${o.status}`,
        movedItems: o.movedItems,
        openDecision: 12,
        why: 'The spelling pointed at the line, which blocks the link of the line. It now points at the house.',
      });
    for (const o of J('stage-c1/c4-brand-links.result.json').out)
      entries.push({
        decision: 'link',
        spelling: brand(o.before.child),
        brand: brand(o.before.house),
        status: o.status === 200 ? STAGE_1 : `refused, ${o.status}`,
        movedItems: o.movedItems,
        productsMoved: o.moving.map((p) =>
          product(p.id, { ...i1.get(p.id), brand: p.brand, es: p.es })
        ),
        openDecision: 12,
      });
    out.push(
      writeData(
        'c04-brand-lines.json',
        {
          step: 'C4',
          title:
            'Decision 12: six lines join their house, and Invictus joins Paco Rabanne',
          sources: [
            'stage-c1/c4-brand-names.answers.json',
            'stage-c1/c4-brand-spellings.result.json',
            'stage-c1/c4-brand-links.result.json',
          ],
          keys:
            KEYS_C +
            ' A brand is keyed by its label and its key. A product that a link moved is keyed with the name it had at the link, which is the new name.',
          decidedBy: 'The owner, 2026-10-06 (decision 12).',
          order:
            'The nine names first, then the three blocking spellings, then the seven links (rule R18).',
        },
        entries
      )
    );
  }

  // ---- C5, decision 4 -----------------------------------------------------------------
  {
    startGaps();
    const state = J('stage-c3/d3-state.after-import.json');
    const shop = (id) => {
      const s = state.shops.find((x) => x.id === id);
      return {
        chain: 'Deza',
        address: s.address,
        postalCode: s.postalCode,
        city: s.city,
        provider: s.externalProvider,
        externalRef: s.externalRef,
        localId: s.id,
      };
    };
    const first = new Map(
      JL('stage-c1/c5-shops.result.jsonl').map((l) => [l.code, l])
    );
    const last = new Map(
      JL('stage-c3/d2-shops.result.jsonl').map((l) => [l.code, l])
    );
    const later = { C1: LATER.shops, Z1: LATER.shops, C2: LATER.shops };
    later.T2 = later.T7 = LATER.discovery;
    const entries = state.sourceLocations
      .map((s) => {
        const a = first.get(s.externalId);
        const b = last.get(s.externalId);
        const code = {
          chain: 'Deza',
          externalId: s.externalId,
          printedName: s.printedName,
          localId: s.id,
        };
        const base = { shopCode: code };
        if (a?.mode === 'ignore')
          return {
            ...base,
            decision: { action: 'ignore' },
            status: STAGE_1,
            openDecision: 4,
            why: 'Not a shop. Never mapped.',
          };
        if (a || b)
          return {
            ...base,
            decision: {
              action: 'map',
              shop: shop(a ? a.location.id : b.shopId),
            },
            status: a ? STAGE_1 : STAGE_3,
            shopRowsWritten: a ? a.after.locationRows.rows : b.written,
            openDecision: 4,
            ...(later[s.externalId]
              ? { ownerAnswerAfterTheRegister: later[s.externalId] }
              : {}),
            why: a
              ? 'The street of the code is in the address of exactly one Deza shop.'
              : s.externalId === 'T2'
                ? 'The shop came from the store discovery of stage 3. Its address holds the street of the code.'
                : 'No address holds the printed name. The owner named the shop.',
          };
        return {
          ...base,
          decision: { action: 'none' },
          status: 'left',
          openDecision: 4,
          ownerAnswerAfterTheRegister: later[s.externalId],
          why: 'The store discovery of stage 3 met no Deza shop at this street, so no shop exists to map the code to.',
        };
      })
      .sort((x, y) =>
        x.shopCode.externalId.localeCompare(y.shopCode.externalId)
      );
    const run = J('stage-c3/d3.run.poll.json');
    const body = J('stage-c3/body.d3-run.json');
    const place = J('stage-c3/d3.import.answer.json').answer;
    entries.push({
      place: {
        provider: place.provider,
        externalRef: place.externalRef,
        name: place.name,
        street: place.street,
        postalCode: place.postalCode,
        city: place.city,
        localId: place.id,
      },
      decision: {
        action: 'import-as-shop',
        shop: shop(place.supermarketLocationId),
      },
      run: {
        mode: run.mode,
        postalCode: body.postalCode,
        radiusMetres: body.radiusMetres,
        placesMet: run.processed,
        placesNew: run.created,
        localId: run.id,
      },
      status: STAGE_3,
      openDecision: 4,
      ownerAnswerAfterTheRegister: LATER.discovery,
      why: 'The one Deza place of the discovery that the catalog did not hold as a shop.',
    });
    out.push(
      writeData(
        'c05-deza-shop-codes.json',
        {
          step: 'C5',
          title:
            'Decision 4: the Deza shop codes, the shops they map to, and the store discovery',
          sources: [
            'stage-c1/c5-shops.result.jsonl',
            'stage-c3/d2-shops.result.jsonl',
            'stage-c3/d3.run.poll.json',
            'stage-c3/d3.import.answer.json',
            'stage-c3/d3-state.after-import.json',
          ],
          keys: 'A shop code is keyed by its chain, its code and its printed name. A shop is keyed by its chain, its address, its postal code and its OpenStreetMap reference.',
          decidedBy:
            'The owner, 2026-10-06 (decision 4), and two later answers of the same day: the shops of C1, Z1 and C2, and the store discovery for T2 and T7.',
          note: 'A mapping publishes the stored claims of the shop in the same request. shopRowsWritten is the count of supermarket_location_items of the shop after it.',
        },
        entries
      )
    );
  }

  // ---- C6, decision 7 -----------------------------------------------------------------
  {
    startGaps();
    const wine = J('stage-c3/d4.wine.answer.json').answer;
    const sausages = J('stage-c3/d4.frankfurt.answer.json').answer;
    const coren = J('stage-c3/d4.coren.accept.answer.json');
    const corenName = J('stage-c3/d4.coren.name.answer.json').body.items[0];
    const stage3 = new Map([
      [
        wine.entry.id,
        {
          decision: { action: 'create', product: created(wine.createdItem) },
          pricesWritten: wine.pricesWritten,
          ownerAnswerAfterTheRegister: LATER.ownProduct,
        },
      ],
      [
        sausages.entry.id,
        {
          decision: {
            action: 'create',
            product: created(sausages.createdItem),
          },
          pricesWritten: sausages.pricesWritten,
          ownerAnswerAfterTheRegister: LATER.ownProduct,
        },
      ],
      [
        coren.answer.entry.id,
        {
          decision: {
            action: 'accept',
            onto: P(i3, coren.body.itemId),
            thenRenamed: {
              nameEs: corenName.name.es,
              nameEn: corenName.name.en,
            },
          },
          pricesWritten: coren.answer.pricesWritten,
          ownerAnswerAfterTheRegister: LATER.coren,
        },
      ],
    ]);
    const entries = J('stage-c1/c6-eljamon.result.json').report.map((e) => {
      const base = {
        row: R(e.entryId),
        ...(e.proposed ? { notAcceptedOnto: P(i1, e.proposed) } : {}),
      };
      if (e.action === 'left')
        return {
          ...base,
          ...stage3.get(e.entryId),
          status: 'left in stage 1, ' + STAGE_3,
          openDecision: 7,
          why: e.why,
        };
      return {
        ...base,
        decision:
          e.action === 'accept'
            ? { action: 'accept', onto: P(i1, e.target.id) }
            : { action: 'create', product: created(e.answer.createdItem) },
        pricesWritten: e.answer.pricesWritten,
        status: STAGE_1,
        openDecision: 7,
        why: e.why,
      };
    });
    out.push(
      writeData(
        'c06-el-jamon-candidates.json',
        {
          step: 'C6',
          title:
            'Decision 7: each El Jamón candidate is bound to the product of its own brand, or gets one',
          sources: [
            'stage-c1/c6-eljamon.result.json',
            'stage-c3/d4.wine.answer.json',
            'stage-c3/d4.frankfurt.answer.json',
            'stage-c3/d4.coren.accept.answer.json',
            'stage-c3/d4.coren.name.answer.json',
          ],
          keys: KEYS_C,
          decidedBy:
            'The owner, 2026-10-06 (decision 7). An agent read each row in stage 1 and left three. The owner answered those three later the same day.',
          note: 'notAcceptedOnto is the product of another brand that the queue proposed. No reject route was called: the bind drops the proposal.',
        },
        entries
      )
    );
  }

  // ---- C7, decision 2 -----------------------------------------------------------------
  {
    startGaps();
    const entries = J('stage-c1/c7-mercadona.result.json').report.map((e) => {
      const c = e.answer.createdItem;
      const later = /^Vela /.test(c.name.es)
        ? LATER.candle
        : c.brand === 'Coca Cola'
          ? LATER.cocaCola
          : null;
      return {
        row: R(e.entryId),
        ...(e.proposed ? { notAcceptedOnto: P(i1, e.proposed) } : {}),
        decision: { action: 'create', product: created(c) },
        pricesWritten: e.answer.pricesWritten,
        status: STAGE_1,
        openDecision: 2,
        ...(later ? { ownerAnswerAfterTheRegister: later } : {}),
        why: e.why,
      };
    });
    for (const i of J('stage-c1/c7-old-names.answers.json').items)
      entries.push({
        decision: 'rename',
        product: P(i1, i.itemId),
        newNameEs: i.name.es,
        newNameEn: i.name.en,
        status: STAGE_1,
        openDecision: 2,
        why: i._why,
      });
    out.push(
      writeData(
        'c07-mercadona-candidates.json',
        {
          step: 'C7',
          title:
            'Decision 2: each Mercadona candidate gets a product of its own, and the container goes in both names of a pair',
          sources: [
            'stage-c1/c7-mercadona.result.json',
            'stage-c1/c7-old-names.answers.json',
          ],
          keys: KEYS_C,
          decidedBy: 'The owner, 2026-10-06 (decision 2).',
          note: 'The container or the count was read from the stored link of each row. The harvester stores no detail payload.',
        },
        entries
      )
    );
  }

  // ---- C8, decision 6 -----------------------------------------------------------------
  {
    startGaps();
    const read = new Map(J('stage-c1/c8-pairs.read.json').map((p) => [p.n, p]));
    const names = new Map(
      J('stage-c3/body.d5-names.json').items.map((i) => [i.itemId, i.name])
    );
    // A counted product stands in several pairs, so a merge is named by both products.
    const both = (kept, gone) => `${kept} ${gone}`;
    const merges2 = J('stage-c2/c8-pairs.merges.json').merges;
    const merges3 = J('stage-c3/d5.merges.json').merges;
    const merged2 = new Set(merges2.map((m) => both(m.kept, m.gone)));
    const merged3 = new Set(merges3.map((m) => both(m.kept, m.gone)));
    const gone = new Set([...merges2, ...merges3].map((m) => m.gone));
    const person = { 3: LATER.bref, 37: LATER.vanilla };
    const entries = J('stage-c1/c8-pairs.verdicts.json').map((v) => {
      const side = (s, r) => ({
        ...P(i1, s.id),
        rows: r.rows.map((x) => R(x.id)),
      });
      const p = read.get(v.n);
      const common = {
        pair: v.n,
        kind: 'gram-and-unit',
        readingOfStage1: v.verdict,
        openDecision: 6,
      };
      if (merged2.has(both(v.measured.id, v.counted.id)))
        return {
          ...merge(rows2, i2, v.measured.id, v.counted.id, common),
          status: 'read in stage 1, ' + STAGE_2,
          why: v.reason,
        };
      if (merged3.has(both(v.measured.id, v.counted.id)))
        return {
          ...merge(rows3, i3, v.measured.id, v.counted.id, common),
          keptRenamed: {
            nameEs: names.get(v.measured.id).es,
            nameEn: names.get(v.measured.id).en,
          },
          status: 'left in stage 1, ' + STAGE_3,
          ownerAnswerAfterTheRegister: LATER.marcilla,
          why: v.reason,
        };
      return {
        decision: 'no merge',
        measured: side(v.measured, p.measured),
        counted: side(v.counted, p.counted),
        ...common,
        status: person[v.n]
          ? 'left by decision'
          : gone.has(v.counted.id)
            ? 'left: two products. The counted product was merged in another pair'
            : 'left: two products',
        ...(person[v.n]
          ? { ownerAnswerAfterTheRegister: person[v.n] }
          : {}),
        why: v.reason,
      };
    });
    out.push(
      writeData(
        'c08-grams-and-units.json',
        {
          step: 'C8',
          title:
            'Decision 6: the 47 pairs of one product stored by weight and by count',
          sources: [
            'stage-c1/c8-pairs.read.json',
            'stage-c1/c8-pairs.verdicts.json',
            'stage-c2/c8-pairs.merges.json',
            'stage-c3/d5.merges.json',
            'stage-c3/body.d5-names.json',
            'the row snapshots of stage-c2 and stage-c3',
          ],
          keys: KEYS_C,
          decidedBy:
            'The owner, 2026-10-06 (decision 6). An agent read the 47 pairs against the five conditions of plan 0192, section 2.8. The owner answered the four pairs it left for a person later the same day.',
          note: 'A merge keeps the product in grams or millilitres (rule R30). No merge cascaded a price row: the settle of plan 0191 moved the price with the row.',
        },
        entries
      )
    );
  }

  // ---- C9, decision 10 ----------------------------------------------------------------
  {
    startGaps();
    const a = J('stage-c2/step1.create.answer.json').answer;
    const entries = [
      {
        row: R(a.entry.id),
        movedFrom: P(i2, a.settled.itemId),
        decision: { action: 'create', product: created(a.createdItem) },
        pricesWritten: a.pricesWritten,
        settleOfTheOldProduct: {
          pricesWithdrawn: a.settled.pricesWithdrawn,
          pricesRestated: a.settled.pricesRestated,
          offersRemoved: a.settled.offersRemoved.length,
        },
        status: STAGE_2,
        openDecision: 10,
        why: 'Two articles of El Jamón, at 2.45 and at 2.95, stood on one product. The row that prints "king" got a product of its own, 240 g as printed (rule R32). The settle of plan 0191 took the 2.95 off the old product and wrote the 2.45 again.',
      },
    ];
    out.push(
      writeData(
        'c09-the-burger-king.json',
        {
          step: 'C9',
          title: 'Decision 10: the El Pozo burger "king" gets a product of its own',
          sources: ['stage-c2/step1.create.answer.json'],
          keys: KEYS_C,
          decidedBy: 'The owner, 2026-10-06 (decision 10).',
        },
        entries
      )
    );
  }

  // ---- C10, decision 11 ---------------------------------------------------------------
  {
    startGaps();
    // The eight products are those of plan 0192, section 3.2.
    const pairs = [
      ['Aguacate', '4797568b', 'e4caee7e', 'stage-c3/d6.aguacate.answer.json'],
      ['Kiwi verde', 'db60d97b', 'b0d8331d', 'stage-c3/d6.kiwi.answer.json'],
      ['Manzana Golden', '35b3cfa6', '7c039a16', 'stage-c3/d6.golden-bag.answer.json'],
      ['Manzana roja dulce', 'd01f0c3a', '6a119592', null],
    ];
    const full = (short) => [...i3.keys()].find((id) => id.startsWith(short));
    const entries = pairs.map(([name, singular, plural, file]) => {
      const base = {
        pair: name,
        singular: P(i3, full(singular)),
        plural: P(i3, full(plural)),
        openDecision: 11,
        ownerAnswerAfterTheRegister: LATER.fruit,
      };
      if (!file)
        return {
          ...base,
          decision: { action: 'none' },
          status: 'nothing to move',
          why: 'No row of another chain is bound to either product of the pair.',
        };
      const a = J(file).answer;
      return {
        ...base,
        decision: a.createdItem
          ? {
              action: 'create',
              row: R(a.entry.id),
              product: created(a.createdItem),
            }
          : { action: 'accept', row: R(a.entry.id), onto: 'singular' },
        pricesWritten: a.pricesWritten,
        settleOfThePluralProduct: {
          pricesWithdrawn: a.settled.pricesWithdrawn,
          offersRemoved: a.settled.offersRemoved.length,
        },
        status: STAGE_3,
        why: a.createdItem
          ? 'The El Jamón row is a fixed bag of 1.5 kg. It left the plural product and got a product of its own.'
          : 'The El Jamón row sells the fruit loose by the kilo. It left the plural product for the singular one.',
      };
    });
    // The five rows that `stage-c3/d6.reading.md` names under "Not done".
    const after3 = rows3[1];
    const i3end = items('stage-c3/items-snapshot.c9-end.json');
    for (const short of ['a7ff8698', '060509fc', 'c8e56f0c', '8cbcbadd', '946ab4c6']) {
      const r = [...after3.values()].find((x) => x.id.startsWith(short));
      entries.push({
        row: R(r.id),
        boundTo: P(i3end, r.itemId),
        decision: { action: 'none' },
        status: 'left for a person',
        openDecision: 11,
        why: 'A loose fruit row of another chain on a product that is not the singular one. It names a variety, an origin or a size that the singular product does not.',
      });
    }
    out.push(
      writeData(
        'c10-fruit-pairs.json',
        {
          step: 'C10',
          title:
            'Decision 11: the singular fruit is the loose fruit, and the plural is the bag',
          sources: [
            'stage-c3/d6.reading.md',
            'stage-c3/d6.aguacate.answer.json',
            'stage-c3/d6.kiwi.answer.json',
            'stage-c3/d6.golden-bag.answer.json',
          ],
          keys: KEYS_C,
          decidedBy:
            'The owner, 2026-10-06. The test of decision 11 (the Mercadona row sold by weight) told no pair apart, because all eight rows are sold by weight. The owner then named the singular product as the loose fruit.',
        },
        entries
      )
    );
  }

  // ---- C11, decision 9 ----------------------------------------------------------------
  {
    startGaps();
    const brandBody = J('stage-c3/body.d1-brand.json').items[0];
    const nameBody = J('stage-c3/body.d1-name.json').items[0];
    const entries = J('stage-c3/d1.merges.json').merges.map((m) => ({
      ...merge(rows3, i3, m.kept, m.gone, { kind: 'probable duplicate' }),
      ...(m.kept === brandBody.itemId
        ? {
            keptBrandSetTo: brandBody.brand,
            keptRenamed: {
              nameEs: nameBody.name.es,
              nameEn: nameBody.name.en,
            },
          }
        : {}),
      status: STAGE_3,
      openDecision: 9,
      ownerAnswerAfterTheRegister: LATER.duplicates,
      why: 'One product stored twice, made visible by the brand links of step A11.',
    }));
    out.push(
      writeData(
        'c11-probable-duplicates.json',
        {
          step: 'C11',
          title: 'Decision 9: the four probable duplicates are merged',
          sources: [
            'stage-c3/d1.merges.json',
            'stage-c3/body.d1-brand.json',
            'stage-c3/body.d1-name.json',
            'the row snapshots of stage-c3',
          ],
          keys: KEYS_C,
          decidedBy:
            'The owner, 2026-10-06. The owner first held decision 9, then answered it the same day.',
          note: 'The kept product is the one that holds the barcode or the price (rule R25). Its name is the name of the pair.',
        },
        entries
      )
    );
  }

  // ---- C12, decision 16 ---------------------------------------------------------------
  {
    startGaps();
    const a = J('stage-c2/step3.settle-real.answer.json');
    const entries = [
      {
        product: P(i2, a.answer.itemId),
        decision: {
          action: 'settle',
          chain: CHAINS[a.answer.supermarketId],
        },
        offersRemoved: a.answer.offersRemoved.length,
        pricesWithdrawn: a.answer.pricesWithdrawn,
        status: STAGE_2,
        openDecision: 16,
        why: 'The 20 El Jamón offers with no price came from the wrong bind of October. No bound row of the chain states them. The dry run answered these 20 offers and nothing else, so the call ran.',
      },
    ];
    out.push(
      writeData(
        'c12-the-f1-figurine.json',
        {
          step: 'C12',
          title: 'Decision 16: the F1 figurine loses its 20 El Jamón offers',
          sources: ['stage-c2/step3.settle-real.answer.json'],
          keys: KEYS_C,
          decidedBy:
            'The owner, 2026-10-06 (decision 16): wait for the code of plan 0191. The settle route of that plan made the one call.',
        },
        entries
      )
    );
  }

  // ---- C13, the categories ------------------------------------------------------------
  {
    startGaps();
    const slugs = (o) => o.cats.split(',').map((c) => c.split(':')[0]);
    const after = new Map(
      J('stage-c3/d7.after.json').map((x) => [x.id, slugs(x)])
    );
    const entries = [];
    for (const b of J('stage-c3/d7.before.json')) {
      const was = slugs(b);
      if (!was.includes('uncategorised')) continue;
      const now = after.get(b.id);
      const changed = now.join() !== was.join();
      entries.push({
        product: product(b.id, itemState(b)),
        decision: changed
          ? { action: 'set-categories', slugs: now }
          : { action: 'none' },
        was,
        status: changed ? STAGE_3 : 'left',
        why: changed
          ? 'The categories of its sibling product.'
          : 'No sibling product holds a category that fits. The leaf shoe-care exists and holds no product.',
      });
    }
    out.push(
      writeData(
        'c13-categories.json',
        {
          step: 'C13',
          title:
            'The categories of the products that plan 0192 created with none',
          sources: ['stage-c3/d7.before.json', 'stage-c3/d7.after.json'],
          keys: 'Each product is keyed as the read before the batch printed it.',
          decidedBy:
            'The stage 3 session of plan 0192. No decision of the owner names a category.',
        },
        entries
      )
    );
  }

  return out;
}
