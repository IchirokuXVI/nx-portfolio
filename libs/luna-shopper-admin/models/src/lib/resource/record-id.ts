import type { AnyResourceDescriptor } from './resource-descriptor';
import type { FilterValue, ResourceRow } from './resource-field';

/**
 * The one rule that says whether typed text is a record's ID (admin plan
 * 0051).
 *
 * Every search of the back office takes text. When the text is an ID, the
 * search stops being a search: it reads the one record of **its own table**
 * that has the ID, and says so in plain words when there is none. An operator
 * who holds an ID from a log line or a database row can then use it anywhere
 * a name is asked for, and nobody else ever has to see one.
 *
 * Every table the gateway reads one row of is keyed by a uuid, so the rule is
 * the shape of a uuid and nothing looser. A postal code, a brand key and an
 * EAN are not IDs here: each of them is already what its own search matches.
 */
const RECORD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The ID a typed term is, or `null` when the term is text.
 *
 * Pasted text arrives with what was around it, so the space at both ends is
 * dropped and the case is lowered: Postgres prints a uuid in lower case, and
 * a row's ID is compared as a string. Text that only contains an ID is not
 * one. "Find 3f2a…" is a search for those words.
 */
export function recordIdIn(term: string): string | null {
  const id = term.trim().toLowerCase();
  return RECORD_ID.test(id) ? id : null;
}

/** The two facts of a descriptor the rule reads. */
type Searched = Pick<AnyResourceDescriptor, 'filters' | 'readById'>;

/**
 * The ID a term is **for this resource**, or `null`.
 *
 * `null` for every term where the resource cannot be read by ID
 * (`readById: false` on its descriptor). The term is then text, and the search
 * does with it what it always did.
 */
export function recordIdFor(
  descriptor: Pick<Searched, 'readById'>,
  term: string
): string | null {
  return descriptor.readById === false ? null : recordIdIn(term);
}

/**
 * The ID typed into a list's search box, or `null`.
 *
 * A list can have more than one box (people are searched by username and by
 * email), and an ID in any of them is the same request.
 */
export function searchedRecordId(
  descriptor: Searched,
  filters: Readonly<Record<string, string>>
): string | null {
  for (const filter of descriptor.filters ?? []) {
    if (filter.kind !== 'search') {
      continue;
    }
    const id = recordIdFor(descriptor, filters[filter.param] ?? '');
    if (id !== null) {
      return id;
    }
  }
  return null;
}

/**
 * Whether a row belongs to what a screen already decided.
 *
 * A read by ID is not narrowed by anything: `/locations/{id}` answers the shop
 * of any chain. A list under one chain, and a picker over one chain's shops,
 * must not show a row of another chain, so the row is held against the same
 * values the list sends as filters.
 *
 * Only a value the row carries can be checked. A filter that is not a column,
 * such as the `kind` of a category, passes here and stays the server's to
 * refuse.
 */
export function rowWithin(
  row: ResourceRow,
  within: Readonly<Record<string, FilterValue>>
): boolean {
  return Object.entries(within).every(([name, wanted]) => {
    const held = row[name];
    if (typeof held !== 'string' || wanted === '') {
      return true;
    }
    return typeof wanted === 'string' ? held === wanted : wanted.includes(held);
  });
}
