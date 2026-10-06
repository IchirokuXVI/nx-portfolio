// Stage B of backend plan 0186: steps B1 to B5.
import {
  J,
  JL,
  itemState,
  mdTables,
  product,
  firstKnown,
  row,
  rowState,
  startGaps,
  writeData,
} from './lib.mjs';

const KEYS_B =
  'Each product is keyed as it stood at the start of stage B (stage-b/items-snapshot.before.json), or as the read of the step printed it.';

export function stageB({ startB, rows }) {
  const out = [];
  const P = (id) => product(id, startB.get(id));
  const PI = (o) => product(o.id, itemState(o));
  const RI = (r) => row(r.id, rowState(r));
  const R = (id, seen) => row(id, firstKnown(rows.get(id), seen));

  // ---- B1 -----------------------------------------------------------------------------
  {
    startGaps();
    const entries = J('stage-b/b1-three-pieces.answers.json').items.map(
      (i) => ({
        product: P(i.itemId),
        decision: { action: 'set-unit', size: null, unit: 'KILOGRAM' },
        status: 'applied',
        why: 'After the Mercadona run the row says it is sold by weight and sends no size.',
        printedRow: i._row,
      })
    );
    const left = J('stage-b/b1-left.end.json');
    for (const l of left.list) {
      const first = l.prices[0];
      const fish = first.chain === 'Mercadona';
      const implied =
        fish && first.price && first.unitPrice
          ? Math.round((first.price / first.unitPrice) * 1000)
          : undefined;
      entries.push({
        product: P(l.itemId),
        decision: { action: 'none' },
        status: 'left',
        openDecision: fish ? 3 : first.chain === 'Deza' ? 1 : 11,
        why: l.why,
        priceRows: l.prices.length,
        price: first.price,
        unitPrice: first.unitPrice,
        unitPriceLabel: first.label,
        ...(implied
          ? { gramsThatPriceOverUnitPriceGives: implied }
          : {}),
        rows: l.rows.map(RI),
      });
    }
    out.push(
      writeData(
        'b01-prices-by-the-kilo.json',
        {
          step: 'B1',
          title:
            'Products sold by the kilo: the three pieces, and the price rows the runs left',
          sources: [
            'stage-b/b1-three-pieces.answers.json',
            'stage-b/b1-left.end.json',
            'stage-b-summary.md',
          ],
          keys: KEYS_B,
          decidedBy:
            'The three pieces: plan 0186 and the rule that a piece sold by weight is KILOGRAM with no size. Nobody decided the rows left.',
          runs: {
            mercadona:
              'b3a3f87d-9fc3-44ce-b95e-38bf3fd97dac, CATALOG_DISCOVERY, the three Córdoba warehouses 3769, 4694 and 4661, details ALL',
            dezaLeafletImport:
              'refused with 409: the document was already imported by run 794056b6-d61d-464f-b442-cdab962920a6. Not reverted.',
          },
          note: 'gramsThatPriceOverUnitPriceGives is arithmetic on the first price row, not a decision and not a size the chain sent.',
          tally: left.tally,
        },
        entries
      )
    );
  }

  // ---- B2 -----------------------------------------------------------------------------
  {
    startGaps();
    const left = J('stage-b/b2-left.after-deza.json');
    const entries = left.list.map((l) => ({
      product: P(l.itemId),
      decision: { action: 'none' },
      status: 'left',
      openDecision: 5,
      why: 'The Deza run did not see the only website row of this product, so it wrote no offer.',
      rows: l.rows.map((r) => ({
        ...R(r.id, { name: r.name, sizeFormat: r.sizeFormat }),
        lastSeenAt: r.lastSeenAt,
      })),
    }));
    for (const l of J('stage-b/finish-read2.json').locations)
      entries.push({
        shopCode: {
          chain: 'Deza',
          externalId: l.externalId,
          printedName: l.printedName,
          localId: l.id,
        },
        decision: { action: 'none' },
        status: l.status,
        openDecision: 4,
        why:
          l.externalId === 'CONSULTAR'
            ? 'Not a shop. Never map it.'
            : 'No shop of the catalog is mapped to this code, so its claims wait.',
      });
    out.push(
      writeData(
        'b02-deza-run.json',
        {
          step: 'B2',
          title:
            'The Deza run: the products it did not see and the shop codes with no shop',
          sources: [
            'stage-b/b2-left.after-deza.json',
            'stage-b/finish-read2.json',
            'stage-b-summary.md',
          ],
          keys: KEYS_B,
          decidedBy: 'Nobody. Every entry is left.',
          run: '960a32c5-7caf-4405-9dab-359a7e01dded, CATALOG_DISCOVERY, the whole chain',
          withoutAnyDezaScopeRow: left.withoutAnyDezaScopeRow,
          productsBoundFromADezaWebsiteRow:
            left.productsBoundFromADezaWebsiteRow,
        },
        entries
      )
    );
  }

  // ---- B3 -----------------------------------------------------------------------------
  {
    startGaps();
    const read = J('stage-b/b3.read.json');
    const entries = read.products.map((p) => ({
      product: product(p.id, { ...itemState(p), size: 1, unit: 'UNIT' }),
      decision: p.becomes
        ? {
            action: 'set-size',
            size: p.becomes.unitSize,
            unit: p.becomes.defaultUnit,
          }
        : { action: 'none' },
      status: p.becomes ? 'applied' : 'left',
      why: p.decision,
      rows: p.rows.map((r) => ({ ...RI(r), says: r.says?.text ?? null })),
    }));
    for (const r of J('stage-b/b3-near-merge.result.json').report)
      entries.push({
        decision: 'merge',
        kind: r.kind,
        kept: PI(r.before.kept),
        deleted: PI(r.before.gone),
        rowsMoved: r.accepts.map((a) => R(a.entryId, { name: a.name })),
        priceRowsCascaded: r.cascadedPriceRows.length,
        status: 'applied after the 131 sizes',
        why: 'The new sizes made the two products equal in brand, size and unit. The deleted one is the Deza product and held no price.',
      });
    // The two pairs the summary of stage B says a person should look at.
    const aPersonLooks = /^(Tampones regular Pearl con aplicador|Tampones Pearl regular|Recambios cepillo dental eléctrico Pro Precision Clean|Recambio cepillo eléctrico Precision)$/;
    for (const n of J('stage-b/pairs.after-b3-merges.json').near)
      entries.push({
        decision: 'no merge',
        a: PI(n.a),
        b: PI(n.b),
        status:
          aPersonLooks.test(n.a.es) && aPersonLooks.test(n.b.es)
            ? 'left for a person'
            : 'left, read as two products',
        why: n.how,
      });
    out.push(
      writeData(
        'b03-sizes-of-one-unit.json',
        {
          step: 'B3',
          title:
            'Products sized 1 UNIT, the merges the new sizes uncovered, and the near pairs left',
          sources: [
            'stage-b/b3.read.json',
            'stage-b/b3.answers.json',
            'stage-b/b3-near-merge.result.json',
            'stage-b/pairs.after-b3-merges.json',
            'stage-b-summary.md',
          ],
          keys: 'Each product is keyed as the read of the step printed it, after the two runs of stage B. Its size was 1 UNIT. Each queue row is the row as the runs left it.',
          decidedBy:
            'Plan 0186, target B3. An agent read each product against its rows. The verdict on the 16 near pairs is the reading of the finish pass from the file.',
          tally: read.tally,
        },
        entries
      )
    );
  }

  // ---- B4 -----------------------------------------------------------------------------
  {
    startGaps();
    const verdict = new Map();
    for (const t of mdTables('stage-b-summary.md'))
      if (t.header[0] === 'Row' && t.header[3] === 'Decision and why')
        for (const r of t.rows)
          for (const id of r.Row.match(/`[0-9a-f]{8}`/g) ?? [])
            verdict.set(id.slice(1, 9), r['Decision and why']);
    const accepted = new Map(
      JL('stage-b/finish-b4-accepts.result.jsonl').map((a) => [a.entryId, a])
    );
    const entries = J('stage-b/finish-candidates.read.json').candidates.map(
      (c) => {
        const a = accepted.get(c.entryId);
        const first = c.row.prices?.[0];
        return {
          row: row(c.entryId, firstKnown(rowState(c.row), rowState(c))),
          size: c.row.size ?? null,
          sizeUnit: c.row.sizeUnit ?? null,
          packCount: c.row.pack ?? null,
          soldByWeight: c.row.weighed ?? null,
          price: first?.price ?? null,
          matchedBy: c.matchedBy,
          proposes: c.product ? PI(c.product) : null,
          sibling: c.sibling
            ? { ...R(c.sibling.id, rowState(c.sibling)), status: c.sibling.status }
            : null,
          decision: a ? 'accept' : 'none',
          status: a
            ? `accepted, ${a.answer.results[0].pricesWritten} price rows written`
            : 'left as CANDIDATE',
          ...(a ? {} : { openDecision: c.chain === 'Mercadona' ? 2 : 7 }),
          why: verdict.get(c.entryId.slice(0, 8)) ?? null,
        };
      }
    );
    out.push(
      writeData(
        'b04-candidate-rows.json',
        {
          step: 'B4',
          title: 'Rows left as CANDIDATE',
          sources: [
            'stage-b/finish-candidates.read.json',
            'stage-b/finish-b4-accepts.result.jsonl',
            'stage-b-summary.md',
          ],
          keys: 'Each queue row is keyed as the finish pass read it, after the two runs. Each proposed product is keyed as that read printed it.',
          decidedBy:
            'An agent (the finish pass of stage B). The plan said to accept the 11 Mercadona rows. The agent accepted none of them and says why on each row.',
        },
        entries
      )
    );
  }

  // ---- B5 -----------------------------------------------------------------------------
  {
    startGaps();
    const entries = [];
    const merged = new Set();
    for (const r of J('stage-b/b5-merge.result.json').report) {
      merged.add(r.kept + r.gone);
      entries.push({
        decision: 'merge',
        kind: r.kind,
        kept: PI(r.before.kept),
        deleted: PI(r.before.gone),
        rowsMoved: r.accepts.map((a) => R(a.entryId, { name: a.name })),
        priceRowsCascaded: r.cascadedPriceRows.length,
        status: 'applied',
        why: 'The same name word for word. The kept product is the one in grams, and the count is in its pack count.',
      });
    }
    const withRows = (o) => ({ ...PI(o), rows: o.rows.map(RI) });
    for (const g of J('stage-b/pairs.after-b3-merges.json').gramAndUnit) {
      if (merged.has(g.measured.id + g.counted.id)) continue;
      entries.push({
        decision: 'no merge',
        measured: withRows(g.measured),
        counted: withRows(g.counted),
        status: 'left for a person',
        openDecision: 6,
        why: g.how,
      });
    }
    out.push(
      writeData(
        'b05-grams-and-units.json',
        {
          step: 'B5',
          title: 'One product stored by weight or volume and by count',
          sources: [
            'stage-b/b5-merge.result.json',
            'stage-b/pairs.after-b3-merges.json',
            'stage-b-summary.md',
          ],
          keys: 'Each product and each queue row is keyed as the pairs read printed it, after the two runs and the B3 merges.',
          decidedBy:
            'Plan 0186, target B5. An agent merged the one pair with the same name word for word and left the rest. Its reasons for the rest were in a report that was lost.',
        },
        entries
      )
    );
  }

  return out;
}
