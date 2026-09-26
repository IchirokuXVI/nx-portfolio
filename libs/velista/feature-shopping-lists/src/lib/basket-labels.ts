import type { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  formatVisitMoment,
  type BasketListRef,
  type BasketParticipant,
  type BasketRow,
  type BasketRowState,
} from '@portfolio/velista/models';
import type { ListPickerRow } from '@portfolio/velista/ui';

/**
 * The three sentences every row on the basket has to be able to say, in one
 * place (plan 0044, sections 4.2 and 4.3).
 *
 * Pure functions taking a translator rather than a pipe in a template, for two
 * reasons. The captions are **conditional on data** ("Marc got 2" against "Guest
 * 2 says they had none" against nothing at all), and a template that branched
 * three ways on each of two fields would be unreadable and untestable. And the
 * same sentences are needed by the settle sheet, which is a different component
 * on the same line.
 */

/**
 * The fields naming somebody actually reads, and nothing more.
 *
 * Structural rather than {@link BasketParticipant}, because the face row names
 * {@link BasketPresenceEntry}s — who is connected right now — and those carry no id
 * under that name, no join time and no device. Both satisfy this, so one pair of
 * functions names a person whichever of the two the caller is holding, and the face
 * and the sheet row can never disagree about what somebody is called.
 */
export type NameableParticipant = Pick<
  BasketParticipant,
  'kind' | 'displayName' | 'guestNumber'
> & {
  /**
   * Optional rather than picked, because a {@link BasketPresenceEntry} does not have
   * one: luna `0054` puts the username on the participant view and not on the presence
   * broadcast, which carries the least it can. A face with no username falls through
   * exactly as it did before, so the two callers keep sharing one pair of functions.
   */
  readonly username?: string | null;
};

/** What a caller can tell these functions that the basket itself does not carry. */
export interface ParticipantNameOptions {
  /**
   * The reader's own account username, for their own row.
   *
   * **Core stores no `displayName` for an `OWNER`** (`basket-sharing.service.ts`
   * creates the row with a null name and a null guest number), so the owner's own
   * participant arrives anonymous and there is nothing on the basket to name them
   * with. The account knows, and only for the reader themself: nobody else's username
   * is on this screen, which is why this is one optional argument rather than a lookup.
   */
  readonly ownName?: string | null;
}

/**
 * What to call somebody.
 *
 * A guest who typed nothing is `Guest N`, from the number the server keeps, which
 * is unique within the basket and stable for the life of the participant. A guest
 * who typed something is shown by it — and the caller must still mark them
 * visibly as a guest, because **the name is for reading and the participant is
 * the identity**: two guests can both be "Dani" and this function will happily
 * return that twice (backend `0051`, section 3.5).
 *
 * ## An unnamed participant is not automatically a guest
 *
 * This used to end at "Guest" for anybody with no name and no number, and the one
 * participant that describes is the **owner**, whose row core deliberately creates
 * unnamed. So the person who made the basket was called Guest, on their own basket,
 * and since every guest is `Guest N` the whole header collapsed to one label with one
 * pair of initials: every face on the screen drew the same two letters.
 *
 * The number is what a guest has and an account holder does not, so it is what the
 * fallback branches on. A `GUEST` with neither is `Guest`; anybody else is named by
 * their account where the reader has it and by what they are otherwise.
 *
 * ## "Owner" and "Member" are the last resort, and they stay
 *
 * `0051` added those two, correctly, as the honest thing to say about somebody the
 * reader had not been given a name for, and they replaced a worse bug where the owner
 * was listed on their own basket as "Guest". But a role is still a place where a
 * person belongs, and the reason one was reached at all is a **backend absence**: core
 * created an owner's row with a null name, and the join screen sent nothing for a
 * signed in joiner. Luna `0054` section 2 carries the account holder's username on the
 * participant, so {@link NameableParticipant.username} now sits between the guest
 * number and the role word.
 *
 * The role fallback is **not deleted** with it, and that is deliberate. A basket
 * generated before that plan shipped carries no username for anybody, and the fallback
 * is what those baskets keep drawing; deleting it would make them draw an empty string.
 *
 * ## A name is still not an identity
 *
 * A username does not make somebody verified to the other people in the shop; it makes
 * them nameable. Two guests may still both type "Dani", the participant id is still
 * the attribution, and the guest ring and the guest tag are exactly where `0051` left
 * them.
 */
export function participantName(
  person: NameableParticipant | null | undefined,
  translator: RokuTranslatorService,
  locale: string,
  options: ParticipantNameOptions = {}
): string {
  if (!person) {
    return '';
  }
  // Typed on purpose, so it wins. A signed in participant may still type a name on the
  // join screen, and if they did they said it deliberately (luna `0054`, section 2.4).
  if (person.displayName !== null && person.displayName !== '') {
    return person.displayName;
  }
  const own = options.ownName?.trim();
  if (own !== undefined && own !== '') {
    return own;
  }
  const username = person.username?.trim();
  if (username !== undefined && username !== '') {
    return username;
  }
  if (person.guestNumber !== null) {
    return translator.t('basket.people.guestNumbered', undefined, locale, {
      count: person.guestNumber,
    });
  }
  if (person.kind !== 'GUEST') {
    // Somebody with an account this basket carries no username for, which after luna
    // `0054` means a basket generated before that plan shipped. What they are is the
    // only true thing left to say about them, and it is a great deal truer than
    // "Guest".
    return translator.t(
      person.kind === 'OWNER' ? 'basket.people.owner' : 'basket.people.member',
      undefined,
      locale
    );
  }
  return translator.t('basket.people.guest', undefined, locale);
}

/**
 * When a visit or a link ends, as one string a sentence interpolates (velista
 * `0094`).
 *
 * "18:40" today, and "tomorrow, 07:15" on any other day, which is section 9's
 * rule: a bare time is ambiguous to somebody who cannot glance at a clock. The
 * two halves come from {@link formatVisitMoment} and the join is a copy key, so
 * a language that writes the day after the time can say so.
 *
 * The share sheet does **not** use this. It has a key per shape, because its
 * sentence is built around the moment rather than interpolating it.
 *
 * @param now Passed in rather than read from the clock, so a spec can place the
 *   moment on either side of midnight.
 */
export function visitTime(
  at: Date,
  translator: RokuTranslatorService,
  locale: string,
  now: Date = new Date()
): string {
  const moment = formatVisitMoment(at, locale, now);
  return moment.day === null
    ? moment.time
    : translator.t('basket.time.dayAndTime', undefined, locale, {
        day: moment.day,
        time: moment.time,
      });
}

/**
 * The letters in somebody's bubble on the face row.
 *
 * Derived from {@link participantName}, so a face and the name beside it in the people
 * sheet can never disagree about who they are about.
 *
 * **Code points, not `slice`.** Slicing cuts a surrogate pair in half, so a name
 * starting with an emoji drew the replacement character; that is `ListViewers`' rule
 * and `accountInitial`'s, and this is the third copy of it because the three draw the
 * same bubble.
 *
 * The guest number is **kept**, and that is the point of the function. Every guest's
 * name begins with the same word, so an initial alone makes `Guest 1` and `Guest 2`
 * one indistinguishable face repeated; the number is the only thing that tells two
 * unnamed guests apart, and it is already what the rest of the screen calls them.
 */
export function participantInitials(
  person: NameableParticipant | null | undefined,
  translator: RokuTranslatorService,
  locale: string,
  options: ParticipantNameOptions = {}
): string {
  if (!person) {
    return '';
  }

  const name = participantName(person, translator, locale, options);
  const initial = (Array.from(name.trim())[0] ?? '').toLocaleUpperCase(locale);

  // A number only where the name did not come from a person: somebody who typed
  // "Dani" is `D`, and appending the number they also happen to have would label
  // them with a fact the screen otherwise never shows them by.
  //
  // A username counts as a person's name for exactly that reason, so it belongs in
  // this test beside the other two. Only a guest carries a number at all, and one who
  // has an account username is not the anonymous row the number exists to tell apart.
  const named =
    (person.displayName !== null && person.displayName !== '') ||
    (options.ownName ?? '').trim() !== '' ||
    (person.username ?? '').trim() !== '';

  return !named && person.guestNumber !== null
    ? `${initial}${person.guestNumber}`
    : initial;
}

export function touchedCaption(
  row: BasketRow,
  people: ReadonlyMap<string, BasketParticipant>,
  translator: RokuTranslatorService,
  locale: string,
  meId: string | null,
  ownName: string | null = null
): string | null {
  if (row.touchedBy === null) {
    return null;
  }

  const name = participantName(people.get(row.touchedBy), translator, locale, {
    ownName: row.touchedBy === meId ? ownName : null,
  });
  if (name === '') {
    return null;
  }

  // **The state and not the numbers.** `NOT_AVAILABLE` closes a row without
  // anything being bought, so `bought` and `left` cannot tell the two apart and a
  // caption derived from them would say "Marc got it" about a shop that had none,
  // which claims a purchase that never happened. The server decides the state
  // (backend `0130`, section 4) and this reads it.
  if (row.state === 'NOT_AVAILABLE') {
    return translator.t('basket.touched.none', undefined, locale, { name });
  }
  if (row.bought === 0) {
    // Touched without anything being bought: a rename, or a purchase somebody has
    // since taken back. There is no honest sentence about a purchase, so there is
    // none.
    return null;
  }

  return row.state === 'DONE'
    ? translator.t('basket.touched.got', undefined, locale, { name })
    : translator.t('basket.touched.gotSome', undefined, locale, {
        name,
        count: row.bought,
      });
}

export function quantityCaption(
  row: Pick<BasketRow, 'state' | 'bought' | 'asked' | 'left'>,
  translator: RokuTranslatorService,
  locale: string
): string {
  if (row.state === 'PARTLY') {
    return translator.t('basket.row.boughtOf', undefined, locale, {
      bought: row.bought,
      asked: row.asked,
    });
  }
  if (row.state === 'DONE' || row.state === 'NOT_AVAILABLE') {
    // Both are finished, and both say what was got out of what was asked for. A
    // `NOT_AVAILABLE` row says "0 of 6", which is true and is the sentence the
    // glyph beside it needs: the shop had none of the six.
    return translator.t('basket.row.boughtOf', undefined, locale, {
      bought: row.bought,
      asked: row.asked,
    });
  }
  return row.left > 1
    ? translator.t('basket.line.wanted', undefined, locale, {
        count: row.left,
      })
    : '';
}

/**
 * The "from" caption naming the households a row came from.
 *
 * **Null when this reader was served no list the row is on**, which is a guest,
 * and null when the row's every entry is on a list the basket did not serve. Both
 * are the same nothing to draw, and the entry's own null `listId` is what says so:
 * there is one question here since backend `0136`, and one answer to it.
 *
 * Names come from the basket's own served refs, which the caller supplies; an
 * entry whose list is not among them is dropped rather than printed.
 */
export function originsCaption(
  row: BasketRow,
  lists: ReadonlyMap<string, BasketListRef>,
  translator: RokuTranslatorService,
  locale: string
): string | null {
  const names = [
    ...new Set(
      row.entries
        .map((entry) =>
          entry.listId === null ? undefined : lists.get(entry.listId)?.name
        )
        .filter((name): name is string => name !== undefined && name !== '')
    ),
  ];

  if (names.length === 0) {
    return null;
  }
  if (names.length === 1) {
    return translator.t('basket.from.one', undefined, locale, {
      first: names[0],
    });
  }
  if (names.length === 2) {
    return translator.t('basket.from.two', undefined, locale, {
      first: names[0],
      second: names[1],
    });
  }
  return translator.t('basket.from.more', undefined, locale, {
    first: names[0],
    count: names.length - 1,
  });
}

/**
 * What a move of the outstanding number is about to do, in one short sentence
 * (plan 0054, section 3).
 *
 * The whole of the row's reel is legible or not on this string. `QuantityReel`
 * commits on release, so between the thumb landing and letting go there is a window
 * in which the consequence can be shown rather than explained, and this is what is
 * shown. It is not a confirmation dialog and must never become one: a dialog on a
 * gesture done one handed over a trolley is the thing `0043` removed from the list
 * page.
 *
 * The two directions say different things because they **are** different things
 * (velista `0073`, section 2): down is units going into the trolley, up is units
 * coming back out of it. Neither sentence says "units", and both count what the
 * gesture moved rather than where it landed, because the number a shopper is deciding
 * about is how many tins changed hands.
 *
 * The raise used to read "buying 20 instead of 5", which is the act `0073` deleted.
 *
 * Null where there is nothing about to happen: no thumb down, or a gesture that came
 * back to where it started.
 *
 * @param current where the run began, which is what is outstanding now
 * @param next where the thumb is, or null when it is not down
 */
export function outstandingCaption(
  current: number,
  next: number | null,
  translator: RokuTranslatorService,
  locale: string
): string | null {
  if (next === null || next === current) {
    return null;
  }

  return next < current
    ? translator.t('basket.outstanding.bought', undefined, locale, {
        count: current - next,
      })
    : translator.t('basket.line.takenBack', undefined, locale, {
        count: next - current,
      });
}

/**
 * The quiet line about this row having been put off, or null (velista `0092`,
 * section 3).
 *
 * Three cases and they are three: the row is skipped now; it was skipped and the
 * server says when; it was skipped and the server sent no date. The third is a
 * guard rather than a case anybody meets, and it draws the undated sentence
 * rather than a sentence with a hole in it.
 *
 * **The date is the server\u2019s** (`noteAt`, which is its `skippedAt`) and it is
 * only formatted here. Nothing on this side decides that twelve hours have
 * passed: it reads a row that already says so, which is why a `SKIPPED` row and a
 * `SKIPPED_EARLIER` one are two answers from the server rather than one answer
 * and a clock.
 *
 * Here beside the row\u2019s other three sentences rather than in the component, for
 * the reason they are here: the date formatting is worth a test of its own, and
 * the testing translator echoes its key without its values, so the only place the
 * argument can be asserted is a direct call.
 */
export function skipCaption(
  row: Pick<BasketRow, 'state' | 'note' | 'noteAt'>,
  translator: RokuTranslatorService,
  locale: string
): string | null {
  if (row.state === 'SKIPPED') {
    return translator.t('basket.skip.caption', undefined, locale);
  }
  if (row.note !== 'SKIPPED_EARLIER') {
    return null;
  }
  if (row.noteAt === null) {
    return translator.t('basket.skip.earlier', undefined, locale);
  }

  return translator.t('basket.skip.earlierOn', undefined, locale, {
    date: formatDay(row.noteAt, locale),
  });
}

/**
 * One date, in the reader\u2019s language.
 *
 * `Intl` rather than `DatePipe`, which is this library\u2019s convention: the pipe
 * needs `registerLocaleData` per locale and a `LOCALE_ID` this app does not set,
 * because the language is runtime state rather than the shell\u2019s build time
 * locale. An unrecognised tag throws a `RangeError`, and an ISO date is a poorer
 * caption than a localized one but a better one than no row at all.
 */
function formatDay(at: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The states that leave a line still to buy: what the server counts as pending. */
const STILL_TO_BUY: ReadonlySet<BasketRowState> = new Set([
  'WANTED',
  'PARTLY',
  'SKIPPED',
]);

/**
 * The basket list picker's rows (velista `0116`): every list a line can go to,
 * each household's lists together in the order the server first names that
 * household, and how many of the list's lines are still to buy.
 *
 * That is the order the target sheet it replaces used, so the lists do not move
 * for anybody who learned them there. The count is per entry, since an entry is one
 * line on one list, and it counts what the server would call pending: wanted,
 * partly bought and skipped for now.
 */
export function listPickerRows(
  lists: readonly BasketListRef[],
  rows: readonly BasketRow[]
): readonly ListPickerRow[] {
  const pending = new Map<string, number>();
  for (const row of rows) {
    for (const entry of row.entries) {
      if (entry.listId !== null && STILL_TO_BUY.has(entry.state)) {
        pending.set(entry.listId, (pending.get(entry.listId) ?? 0) + 1);
      }
    }
  }

  const zones: string[] = [];
  for (const list of lists) {
    if (!zones.includes(list.zoneId)) {
      zones.push(list.zoneId);
    }
  }

  return zones.flatMap((zoneId) =>
    lists
      .filter((list) => list.zoneId === zoneId)
      .map((list) => ({
        listId: list.listId,
        name: list.name,
        zoneName: list.zoneName,
        pending: pending.get(list.listId) ?? 0,
      }))
  );
}
