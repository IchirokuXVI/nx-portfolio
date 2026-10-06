// What each product looked like at two moments, by its uuid.
//
// `startB` is read: `stage-b/items-snapshot.before.json` holds every product at the start of
// stage B, which is the end of stage A.
//
// `beforeA` is replayed: no file holds every product before stage A. It starts from `startB`
// and takes back each write of stage A, newest first, from the "was" value its answers file
// kept. A product that stage A deleted comes from the read made before its merge.
import { J, itemState } from './lib.mjs';

const split = (was) => was.split(' | ').map((s) => s.trim());

export function buildState() {
  const startB = new Map(
    J('stage-b/items-snapshot.before.json').items.map((i) => [
      i.id,
      itemState(i),
    ])
  );
  const m = new Map([...startB].map(([k, v]) => [k, { ...v }]));
  const notFound = [];
  const set = (id, patch) => {
    const x = m.get(id);
    if (!x) return notFound.push(id);
    Object.assign(x, patch);
  };

  // ---- pass 2, newest first -----------------------------------------------------------
  const brands = J('pass2/pass2-j-brands.result.json').report;
  for (const op of brands) {
    if (op.status !== 200) continue;
    if (op.kind === 'rename')
      for (const x of m.values())
        if (x.brandId === op.before.id) x.brand = op.before.label;
    if (op.kind === 'link')
      for (const p of op.moving) set(p.id, { brand: op.before.line.label });
  }
  for (const i of J('pass2/pass2-j-invictus.answers.json').items) {
    const [brand, es] = split(i._was);
    set(i.itemId, { brand, es });
  }
  for (const i of J('pass2/pass2-j-items.answers.json').items) {
    const [brand, es] = split(i._was);
    set(i.itemId, { brand, es });
  }
  for (const i of J('pass2/pass2-a10.answers.json').items)
    set(i.itemId, { es: i._was });
  for (const i of J('pass2/pass2-a9.answers.json').items) {
    const [brand, es] = split(i._was);
    set(i.itemId, { brand, es });
  }
  for (const i of J('pass2/pass2-a5.answers.json').items) {
    const [size, unit] = i._was.split(' ');
    set(i.itemId, { size: Number(size), unit });
  }
  for (const i of J('pass2/pass2-a6-near-rename.answers.json').items)
    set(i.itemId, { es: i._was });
  for (const i of J('pass2/pass2-a3.answers.json').items) {
    const [brand, es, sized] = split(i._was);
    const [size, unit] = sized.split(' ');
    set(i.itemId, { brand, es, size: Number(size), unit });
  }
  for (const f of [
    'pass2/pass2-a6-exact.result.json',
    'pass2/pass2-a6-near.result.json',
    'pass2/pass2-a9-merge.result.json',
  ])
    for (const r of J(f).report) m.set(r.gone, itemState(r.before.gone));

  const afterPass1 = new Map([...m].map(([k, v]) => [k, { ...v }]));

  // ---- pass 1, newest first -----------------------------------------------------------
  for (const g of J('a6.read.json').groups)
    for (const p of g) if (!m.has(p.id)) m.set(p.id, itemState(p));
  for (const l of J('a8.result.json').linked)
    for (const p of l.products) set(p.id, { brand: p.brand });
  const a7 = J('a7.result.json');
  set(a7.skewers.before.product.id, { es: a7.skewers.before.product.name.es });
  m.delete(a7.skewers.created.id);
  for (const i of J('a4.answers.json').items) set(i.itemId, { ean: i._was });
  for (const p of J('a3.read.json'))
    set(p.id, { size: p.unitSize, unit: p.defaultUnit });
  for (const i of J('a2.answers.json').items) set(i.itemId, { pack: i._was });

  return { startB, beforeA: m, afterPass1, notFound };
}

/**
 * The replay, checked against the two reads pass 1 made after its own writes
 * (`a5.read.json` and `a6-near.read.json`). Answers the products that differ.
 */
export function checkReplay(afterPass1) {
  const differ = [];
  const same = (a, b) => (a ?? null) === (b ?? null);
  const cmp = (id, seen, file) => {
    const x = afterPass1.get(id);
    if (!x) return differ.push({ id, file, why: 'not in the replay' });
    for (const k of ['brand', 'es', 'size', 'unit', 'pack'])
      if (!same(x[k], seen[k]))
        differ.push({ id, file, key: k, replay: x[k], read: seen[k] });
  };
  for (const c of J('a5.read.json').cases)
    cmp(c.itemId, itemState({ ...c, es: c.name }), 'a5.read.json');
  for (const pair of J('a6-near.read.json'))
    for (const p of [pair.a, pair.b]) {
      const [size, unit] =
        p.size.startsWith('no size') || !/^[\d.]/.test(p.size)
          ? [null, p.size.split(' ').pop()]
          : [Number(p.size.split(' ')[0]), p.size.split(' ')[1]];
      cmp(
        p.id,
        { brand: p.brand, es: p.es, size, unit, pack: p.packCount },
        'a6-near.read.json'
      );
    }
  return differ;
}
