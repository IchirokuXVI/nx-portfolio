/**
 * The change list a replay carries (plan 0006, sections 1 and 2).
 *
 * Three things live here: the export, which reads one operator's product edits
 * out of a local slot's `catalog_audit`; the reading of a change list file; and
 * the folding of every line of one product into one change, with the classes
 * the folding alone can decide.
 *
 * The export reads only. It runs `psql` in the slot's own catalog container,
 * the way `slots.mjs` runs `pg_dump` there, with the session set read only, so
 * no service and no route is involved and nothing on the slot can change.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { slotProject } from './slots.mjs';

/** The first line of a change list says what it is. */
export const CHANGE_LIST_KIND = 'catalog-changes';

/** The origin a list exported from a slot's audit trail names. */
export const AUDIT_ORIGIN = 'catalog_audit';

/**
 * The fields a replay carries, which are the fields an `expect` of the items
 * batch can guard (plan 0006, section 1).
 *
 * `field` is the property the audit trail records, `send` the property the
 * batch takes for both the edit and the `expect` (the same name unless said),
 * `kind` how two values are compared, and `read` how the lookup's view holds
 * it. A field the `expect` learns to guard is one more line here: backend plan
 * 0278 adds `pieceCount` as `{ field: 'pieceCount', kind: 'number' }`.
 */
export const CARRIED_FIELDS = [
  { field: 'name', kind: 'name' },
  { field: 'brand', kind: 'brand' },
  { field: 'unitSize', kind: 'number' },
  { field: 'approxWeight', kind: 'number' },
  { field: 'quantityStep', kind: 'number' },
  { field: 'defaultUnit', kind: 'text' },
  { field: 'packCount', kind: 'number' },
  {
    field: 'categories',
    send: 'categorySlugs',
    kind: 'slugs',
    read: (item) => (item.categories ?? []).map((category) => category.slug),
  },
].map((spec) => ({
  send: spec.field,
  read: (item) => item[spec.field],
  ...spec,
}));

const CARRIED = new Map(CARRIED_FIELDS.map((spec) => [spec.field, spec]));

/** The spec of a carried field, or undefined for any other. */
export function carriedField(field) {
  return CARRIED.get(field);
}

/**
 * Fields the trail records that follow from another one, read and never sent
 * (plan 0006, section 1): the brand's key and id follow `brand`, who set the
 * weight follows `approxWeight`, and the merge time follows the merge.
 */
export const DERIVED_FIELDS = new Set([
  'brandKey',
  'brandId',
  'approxWeightSetBy',
  'mergedAt',
]);

/** The field whose change makes a line a merge. */
const MERGE_FIELD = 'mergedIntoId';

/** What the folding names a product it will not carry. */
export const NOT_CARRIED = 'not carried';
export const LOCAL_GAP = 'local gap';

/** A uuid, which is all an actor or a product id may be. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Comparison (section 4.2)
// ---------------------------------------------------------------------------

/** A value with nothing in it is null, whatever spelled the nothing. */
function nothing(value) {
  return value === undefined || value === null;
}

/** A trimmed half, or null when the half holds nothing. */
function half(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Both halves of a name, each trimmed, as catalog compares them. */
export function nameHalves(value) {
  return { es: half(value?.es), en: half(value?.en) };
}

/** A number as a number, so `53.0000` and `53` are one value. */
function asNumber(value) {
  if (nothing(value) || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

/** A brand as the client compares it: trimmed and case blind. */
function brandOf(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

/** The categories, as an ordered list of slugs. */
function slugsOf(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Whether two values of a field are one value.
 *
 * `esOnly` compares only the Spanish half of a name, for a change list whose
 * identity came from a file that recorded no more than that half.
 */
export function sameValue(kind, a, b, { esOnly = false } = {}) {
  switch (kind) {
    case 'name': {
      const left = nameHalves(a);
      const right = nameHalves(b);
      return esOnly
        ? left.es === right.es
        : left.es === right.es && left.en === right.en;
    }
    case 'brand':
      return brandOf(a) === brandOf(b);
    case 'number':
      return asNumber(a) === asNumber(b);
    case 'slugs': {
      const left = slugsOf(a);
      const right = slugsOf(b);
      return (
        left.length === right.length &&
        left.every((slug, index) => slug === right[index])
      );
    }
    default: {
      const left = nothing(a) ? null : a;
      const right = nothing(b) ? null : b;
      return typeof left === 'object' || typeof right === 'object'
        ? JSON.stringify(left) === JSON.stringify(right)
        : left === right;
    }
  }
}

/** Two values of any field the trail records, compared as their kind. */
function sameFieldValue(field, a, b) {
  return sameValue(carriedField(field)?.kind ?? 'text', a, b);
}

/** The value a batch is sent for a field, in the shape the route takes. */
export function wireValue(spec, value) {
  switch (spec.kind) {
    case 'name': {
      const halves = nameHalves(value);
      return Object.fromEntries(
        Object.entries(halves).filter(([, text]) => text !== null)
      );
    }
    case 'number':
      return asNumber(value);
    case 'slugs':
      return slugsOf(value);
    case 'brand':
      return nothing(value) ? null : String(value);
    default:
      return nothing(value) ? null : value;
  }
}

// ---------------------------------------------------------------------------
// The export (section 2)
// ---------------------------------------------------------------------------

/** The catalog Postgres of a slot, as `slots.mjs` names it. */
const CATALOG_DB_USER = 'luna_catalog';
const CATALOG_DB_NAME = 'luna_catalog';

/** One ISO time, or an error naming the flag that gave it. */
export function parseTime(value, flag) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${flag} takes an ISO time, for example 2026-11-20T00:00:00Z.`
    );
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    throw new Error(`${flag} is ${value}, and that is not a time.`);
  }
  return time.toISOString();
}

/** The actors, each a uuid, or an error naming the one that is not. */
export function parseActors(values) {
  const actors = values
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  if (actors.length === 0) {
    throw new Error(
      '--actor is required: the admin_users id of the operator whose edits are carried.'
    );
  }
  for (const actor of actors) {
    if (!UUID.test(actor)) {
      throw new Error(`--actor ${actor} is not an admin id (a uuid).`);
    }
  }
  return [...new Set(actors)];
}

/**
 * The window and actors as SQL literals.
 *
 * Every value was checked to be a uuid or an ISO time before it gets here, so
 * a literal cannot carry anything else.
 */
function windowSql({ actors, since, until }) {
  const list = actors.map((actor) => `'${actor}'`).join(', ');
  return `a."actorKind" = 'ADMIN' AND a."actorId" = ANY(ARRAY[${list}]::uuid[]) AND a.at >= '${since}'::timestamptz AND a.at < '${until}'::timestamptz`;
}

/** The product lines of the window, one JSON object a row, oldest first. */
export function exportItemsSql(window) {
  return `SELECT json_build_object('auditId', a.id, 'at', a.at, 'action', a.action, 'itemId', a."entityId", 'before', a.before, 'after', a.after, 'current', json_build_object('name', i.name, 'brand', i.brand)) FROM catalog_audit a LEFT JOIN items i ON i.id = a."entityId" WHERE a.entity = 'items' AND ${windowSql(window)} ORDER BY a.at, a.id`;
}

/** How many rows of every other table the same actors wrote in the window. */
export function exportOtherEntitiesSql(window) {
  return `SELECT coalesce(json_object_agg(entity, n), '{}'::json) FROM (SELECT a.entity, count(*) AS n FROM catalog_audit a WHERE a.entity <> 'items' AND ${windowSql(window)} GROUP BY a.entity ORDER BY a.entity) s`;
}

/**
 * The `docker exec` that runs one read of the export.
 *
 * `psql` runs every `-c` in one session, so the first sets the session read
 * only and the second can then change nothing. `-At` prints each row as its
 * bare text on a line of its own, and `-q` keeps the `SET` tag off stdout.
 * The plan names a `COPY ... TO STDOUT`; its text format doubles every
 * backslash, which breaks a JSON string holding a quote, and a plain `SELECT`
 * under `-At` prints the JSON as it is.
 */
export function exportCommand(slot, sql) {
  return {
    command: 'docker',
    args: [
      'exec',
      '-i',
      `${slotProject(slot)}-catalog-db-1`,
      'psql',
      '-U',
      CATALOG_DB_USER,
      '-d',
      CATALOG_DB_NAME,
      '-Atq',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'SET default_transaction_read_only = on',
      '-c',
      sql,
    ],
  };
}

/** A local slot number, 0 included: the export only reads. */
export function parseSlot(value) {
  const slot = Number(value);
  if (
    typeof value !== 'string' ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot > 9
  ) {
    throw new Error(
      '--slot takes the number of the local slot that holds the edits, 0 to 9.'
    );
  }
  return slot;
}

/** The rows `psql -At` printed, each one JSON object. */
function jsonRows(stdout, what) {
  return String(stdout)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(
          `the ${what} read answered a line ${index + 1} that is not JSON.`
        );
      }
    });
}

/**
 * Exports the change list (section 2.2) and writes it.
 *
 * `run` is the process runner the rest of the CLI uses, injected in every
 * test. It answers the header and the number of lines, and stderr gets the
 * counts and the path only.
 */
export async function exportChanges({
  file,
  slot,
  actors,
  since,
  until,
  run,
  cwd,
  stderr,
  now = () => new Date(),
  writeFile = (path, text) => writeFileSync(path, text, 'utf8'),
}) {
  if (since === undefined || since === null) {
    throw new Error(
      '--since is required, so a whole audit trail is never exported by accident.'
    );
  }
  const window = {
    actors,
    since,
    until: until ?? now().toISOString(),
  };

  const read = async (sql, what) => {
    const { command, args } = exportCommand(slot, sql);
    const answer = await run(command, args, { cwd });
    if (answer.code !== 0) {
      throw new Error(
        `the ${what} read of slot ${slot} failed with exit ${answer.code}: ${(answer.stderr || '').trim()}`
      );
    }
    return jsonRows(answer.stdout, what);
  };

  const lines = await read(exportItemsSql(window), 'audit');
  const [otherEntities = {}] = await read(
    exportOtherEntitiesSql(window),
    'other tables'
  );

  const header = {
    header: true,
    kind: CHANGE_LIST_KIND,
    origin: AUDIT_ORIGIN,
    slot,
    actors,
    since: window.since,
    until: window.until,
    exportedAt: now().toISOString(),
    otherEntities,
  };
  writeFile(
    file,
    [header, ...lines].map((line) => `${JSON.stringify(line)}\n`).join('')
  );
  const products = new Set(lines.map((line) => line.itemId)).size;
  const others = Object.values(otherEntities).reduce(
    (sum, count) => sum + Number(count),
    0
  );
  stderr.write(
    `exported ${lines.length} audit rows of ${products} products to ${file}; ${others} rows of other tables are counted in the header and not carried\n`
  );
  return { header, lines: lines.length, products };
}

// ---------------------------------------------------------------------------
// Reading a change list (section 2.3)
// ---------------------------------------------------------------------------

/** A change list, read and checked line by line. */
export function readChangeList(
  file,
  read = (path) => readFileSync(path, 'utf8')
) {
  const text = read(file);
  const rows = [];
  let header = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const number = index + 1;
    if (raw.trim() === '') {
      return;
    }
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      throw new Error(`${file} line ${number} is not JSON.`);
    }
    if (line?.header === true) {
      if (header !== null) {
        throw new Error(`${file} line ${number} is a second header.`);
      }
      if (rows.length > 0) {
        throw new Error(
          `${file} line ${number} is a header after the changes.`
        );
      }
      header = line;
      return;
    }
    if (header === null) {
      throw new Error(
        `${file} does not start with a header line. It is not a change list.`
      );
    }
    if (typeof line?.itemId !== 'string' || line.itemId === '') {
      throw new Error(`${file} line ${number} names no itemId.`);
    }
    for (const side of ['before', 'after']) {
      const value = line[side];
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'object' || Array.isArray(value))
      ) {
        throw new Error(
          `${file} line ${number} has a ${side} that is not an object.`
        );
      }
    }
    rows.push({ ...line, line: number });
  });
  if (header === null) {
    throw new Error(`${file} holds no header line. It is not a change list.`);
  }
  if (header.kind !== CHANGE_LIST_KIND) {
    throw new Error(
      `${file} is a ${header.kind ?? 'file of no kind'}, not a ${CHANGE_LIST_KIND} list.`
    );
  }
  return { header, lines: rows };
}

// ---------------------------------------------------------------------------
// Folding (section 2.4)
// ---------------------------------------------------------------------------

/**
 * Every line of one product, made into one change.
 *
 * Answers `{ itemId, class, reason, identity, fields, unguarded, auditIds }`.
 * `class` is null for a change the lookup still has to judge, and one of
 * {@link NOT_CARRIED} and {@link LOCAL_GAP} when the lines alone decide it.
 * `fields` holds the carried fields, `unguarded` the fields no `expect` guards,
 * each as `{ field, from, to }`.
 */
export function foldProduct(itemId, lines, { esOnlyIdentity = false } = {}) {
  const auditIds = lines.map((line) => line.auditId ?? `line ${line.line}`);
  const base = {
    itemId,
    class: null,
    reason: null,
    identity: null,
    fields: [],
    unguarded: [],
    auditIds,
  };

  const structural = lines.find(
    (line) =>
      (line.action ?? 'UPDATE') !== 'UPDATE' ||
      (line.after && MERGE_FIELD in line.after)
  );
  if (structural) {
    const action = structural.action ?? 'UPDATE';
    const reason =
      action === 'CREATE'
        ? 'created locally, so the target has no twin of it'
        : action === 'DELETE'
          ? 'deleted locally; a deletion is never carried'
          : `merged locally into ${structural.after[MERGE_FIELD] ?? 'nothing'}; a merge is reported, not carried`;
    return { ...base, class: NOT_CARRIED, reason, action };
  }

  // Each field's first `before` and last `after`, and the chain between them.
  const folded = new Map();
  for (const line of lines) {
    const before = line.before ?? {};
    const after = line.after ?? {};
    const names = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const field of names) {
      if (DERIVED_FIELDS.has(field)) {
        continue;
      }
      const held = folded.get(field);
      const from = before[field] ?? null;
      const to = after[field] ?? null;
      if (held && !sameFieldValue(field, held.to, from)) {
        return {
          ...base,
          class: LOCAL_GAP,
          reason: `${field} was changed between two exported edits by somebody not exported`,
          gapField: field,
        };
      }
      folded.set(field, { field, from: held ? held.from : from, to });
    }
  }

  const moved = [...folded.values()].filter(
    (change) => !sameFieldValue(change.field, change.from, change.to)
  );
  const fields = moved.filter((change) => carriedField(change.field));
  const unguarded = moved.filter((change) => !carriedField(change.field));

  const first = lines[0]?.current ?? {};
  const nameChange = folded.get('name');
  const brandChange = folded.get('brand');
  const identityName = nameChange ? nameChange.from : (first.name ?? null);
  const identity = {
    name: esOnlyIdentity
      ? { es: nameHalves(identityName).es }
      : nameHalves(identityName),
  };
  if (brandChange) {
    identity.brand = brandChange.from ?? null;
  } else if (first && 'brand' in first) {
    identity.brand = first.brand ?? null;
  }

  if (fields.length === 0 && unguarded.length === 0) {
    return { ...base, class: 'dropped', identity };
  }
  if (fields.length === 0) {
    return {
      ...base,
      class: NOT_CARRIED,
      reason: 'it changes only fields no expect guards',
      identity,
      unguarded,
    };
  }
  return { ...base, identity, fields, unguarded };
}

/**
 * Every product of a change list, folded, in the order each first appears.
 *
 * A list from another origin than the audit trail has a weaker identity guard
 * (section 4.2): it compares the Spanish half of a name only, and the `expect`
 * sent carries no name.
 */
export function foldChanges({ header, lines }) {
  const esOnlyIdentity = header.origin !== AUDIT_ORIGIN;
  const byProduct = new Map();
  for (const line of lines) {
    if (!byProduct.has(line.itemId)) {
      byProduct.set(line.itemId, []);
    }
    byProduct.get(line.itemId).push(line);
  }
  const changes = [];
  let dropped = 0;
  for (const [itemId, productLines] of byProduct) {
    const change = foldProduct(itemId, productLines, { esOnlyIdentity });
    if (change.class === 'dropped') {
      dropped += 1;
      continue;
    }
    changes.push(change);
  }
  return { changes, dropped, esOnlyIdentity };
}
