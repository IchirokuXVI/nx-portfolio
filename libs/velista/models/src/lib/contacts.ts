/**
 * The people the reader shares a group with, and how the people picker draws them
 * (velista `0085`, backend `0114` section 2).
 *
 * The server answers **one row per membership**, flat and in no display order: a
 * person in two groups is two rows, each with the name they carry in that group. The
 * grouping and the sort are this client's, because the group names are too, and a
 * page of memberships stays bounded however large one group grows.
 */

/** One approved membership in a group the reader is also approved in. */
export interface Contact {
  readonly userId: string;
  readonly zoneId: string;
  /** The person's name **in that group**, which is why it lives on the membership. */
  readonly username: string;
}

/** One section of the picker: a group, and the people in it. */
export interface ContactGroup {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly people: readonly Pick<Contact, 'userId' | 'username'>[];
}

/**
 * Group the flat memberships by group, and sort both levels for reading.
 *
 * A membership in a group the reader cannot name is left out rather than drawn under
 * a raw id: the zone names come from a different read, and a heading made of a uuid
 * is worse than a section that appears a moment later. A person listed twice in one
 * group, which a page boundary can produce, is drawn once.
 *
 * Both sorts use the reader's locale, so an accented name sorts where a reader of
 * that language expects it.
 */
export function groupContacts(
  contacts: readonly Contact[],
  zoneNames: ReadonlyMap<string, string>,
  locale: string
): readonly ContactGroup[] {
  const byZone = new Map<string, Map<string, string>>();

  for (const contact of contacts) {
    if (!zoneNames.has(contact.zoneId)) {
      continue;
    }
    const people = byZone.get(contact.zoneId) ?? new Map<string, string>();
    if (!people.has(contact.userId)) {
      people.set(contact.userId, contact.username);
    }
    byZone.set(contact.zoneId, people);
  }

  const compare = collator(locale);

  return [...byZone.entries()]
    .map(([zoneId, people]) => ({
      zoneId,
      zoneName: zoneNames.get(zoneId) ?? '',
      people: [...people.entries()]
        .map(([userId, username]) => ({ userId, username }))
        .sort((a, b) => compare(a.username, b.username)),
    }))
    .sort((a, b) => compare(a.zoneName, b.zoneName));
}

/** `localeCompare` through `Intl.Collator`, falling back when the tag is not known. */
function collator(locale: string): (a: string, b: string) => number {
  try {
    return new Intl.Collator(locale, { sensitivity: 'base' }).compare;
  } catch {
    // An unrecognised tag throws `RangeError`. The root collation is still a sort.
    return new Intl.Collator(undefined, { sensitivity: 'base' }).compare;
  }
}
