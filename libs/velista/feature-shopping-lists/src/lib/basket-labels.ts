import type { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  basketLineState,
  outstanding,
  type BasketLine,
  type BasketParticipant,
} from '@portfolio/velista/models';

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
>;

/** What a caller can tell these functions that the basket itself does not carry. */
export interface ParticipantNameOptions {
  /** Render the reader's own name as "you", for a caption that reads as a sentence. */
  readonly you?: boolean;
  /**
   * The reader's own account username, for their own row.
   *
   * **Core stores no `displayName` for an `OWNER`** (`generated-list-sharing.service.ts`
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
  if (options.you) {
    return translator.t('basket.touched.you', undefined, locale);
  }
  if (person.displayName !== null && person.displayName !== '') {
    return person.displayName;
  }
  const own = options.ownName?.trim();
  if (own !== undefined && own !== '') {
    return own;
  }
  if (person.guestNumber !== null) {
    return translator.t('basket.people.guestNumbered', undefined, locale, {
      count: person.guestNumber,
    });
  }
  if (person.kind !== 'GUEST') {
    // Somebody with an account whose name this reader has not been given: the owner
    // seen by a guest is the case that reaches here. What they are is the only true
    // thing left to say about them, and it is a great deal truer than "Guest".
    return translator.t(
      person.kind === 'OWNER' ? 'basket.people.owner' : 'basket.people.member',
      undefined,
      locale
    );
  }
  return translator.t('basket.people.guest', undefined, locale);
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
  const named =
    (person.displayName !== null && person.displayName !== '') ||
    (options.ownName ?? '').trim() !== '';

  return !named && person.guestNumber !== null
    ? `${initial}${person.guestNumber}`
    : initial;
}

/**
 * "Who got the bread", on the row, because that is the question in a shop where
 * four people are working one list and it should not cost a tap (section 4.3).
 *
 * Null when nobody has touched the line, which is the ordinary state of a full
 * basket and draws no caption at all rather than an empty one.
 *
 * The wording distinguishes the three outcomes a person actually cares about:
 * somebody finished it, somebody got some of it, and somebody found none. The
 * last is inferred from a line that is closed with nothing settled against its
 * quantity, which is exactly what a `NOT_AVAILABLE` settle leaves behind.
 */
export function touchedCaption(
  line: BasketLine,
  people: ReadonlyMap<string, BasketParticipant>,
  translator: RokuTranslatorService,
  locale: string,
  meId: string | null
): string | null {
  if (line.touchedBy === null) {
    return null;
  }

  const name = participantName(people.get(line.touchedBy), translator, locale, {
    you: line.touchedBy === meId,
  });
  if (name === '') {
    return null;
  }

  // **The outcome and not the numbers.** `NOT_AVAILABLE` closes the outstanding
  // amount exactly as a purchase does, so `settled` reaches `quantity` either
  // way and a caption derived from it would say "Marc got it" about a shop that
  // had none, which claims a purchase that never happened.
  if (line.lastOutcome === 'NOT_AVAILABLE') {
    return translator.t('basket.touched.none', undefined, locale, { name });
  }
  if (line.lastOutcome === null) {
    // Edited rather than settled: somebody changed the line without buying
    // anything, so there is no honest sentence about a purchase and there is
    // none.
    return null;
  }

  return basketLineState(line) === 'done'
    ? translator.t('basket.touched.got', undefined, locale, { name })
    : translator.t('basket.touched.gotSome', undefined, locale, {
        name,
        count: line.settled,
      });
}

/**
 * The quantity line: how many are wanted, or how far through it is.
 *
 * Two shapes rather than one, because a line nobody has touched should read as
 * plainly as possible ("×3") and a line half done has to show **both** numbers so
 * the person can see what is left without arithmetic (section 4.2).
 */
export function quantityCaption(
  line: BasketLine,
  translator: RokuTranslatorService,
  locale: string
): string {
  const state = basketLineState(line);
  if (state === 'partly') {
    return translator.t('basket.line.partly', undefined, locale, {
      settled: line.settled,
      total: line.quantity,
    });
  }
  if (state === 'done') {
    return '';
  }
  return line.quantity > 1
    ? translator.t('basket.line.wanted', undefined, locale, {
        count: line.quantity,
      })
    : '';
}

/**
 * The "from" caption naming the households a line came from.
 *
 * **Returns null for a reader who may not see origins**, which is not the same as
 * a line with none: `origins` is absent for a guest and present-and-empty for a
 * privileged reader looking at a line typed straight into the basket. Collapsing
 * the two is the bug that draws "from " with nothing after it.
 *
 * Names come from a lookup the caller supplies, because list names live in the
 * zone stores and this file knows nothing about them; an id with no name is
 * dropped rather than printed.
 */
export function originsCaption(
  line: BasketLine,
  listNames: ReadonlyMap<string, string>,
  translator: RokuTranslatorService,
  locale: string
): string | null {
  if (line.origins === undefined) {
    return null;
  }

  const names = [
    ...new Set(
      line.origins
        .map((origin) => listNames.get(origin.listId))
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

/** How many are still to get, for the settle sheet's buttons. */
export function outstandingOf(line: BasketLine): number {
  return outstanding(line);
}
