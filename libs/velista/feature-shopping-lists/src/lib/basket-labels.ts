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
 *
 * ## The reader is named, not called "you"
 *
 * This used to draw "you got it" for a line the reader had settled, and plan 0052
 * section 2.1 takes that back. The screen is four people working one list in a shop
 * and reading it on **each other's phones** over a trolley: "you got it" is unreadable
 * when the phone in your hand is not yours, and it was the only caption here that
 * changed meaning depending on who was holding the device.
 *
 * So the reader is named like everybody else, and {@link ParticipantNameOptions.ownName}
 * is how: core keeps no `displayName` for an owner, so the reader's own account name is
 * the only thing that can name their own row on a basket generated before luna `0054`.
 * The caller passes it rather than resolving it, because this file has no account and a
 * row component rendered once per line should not gain a `SessionStore`.
 *
 * @param ownName the reader's own account name, or null for a guest, who has no
 *   account and whose own row the server does name.
 */
export function touchedCaption(
  line: BasketLine,
  people: ReadonlyMap<string, BasketParticipant>,
  translator: RokuTranslatorService,
  locale: string,
  meId: string | null,
  ownName: string | null = null
): string | null {
  if (line.touchedBy === null) {
    return null;
  }

  const name = participantName(people.get(line.touchedBy), translator, locale, {
    ownName: line.touchedBy === meId ? ownName : null,
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
 * "Who put this here", for a line nobody has touched yet (plan 0053, section 5).
 *
 * The question a shop asks about a row nobody recognises, and one the basket could
 * not answer until luna `0055` wrote {@link BasketLine.createdBy}: every line came
 * from the run, so there was nobody to name.
 *
 * ## It yields to {@link touchedCaption}, and does not sit beside it
 *
 * Null the moment anybody has touched the line, because the row has three short
 * lines and "who got the bread" is the more urgent of the two while somebody is
 * shopping. The **field** is still worth keeping past that point, which is the whole
 * argument for it being a second column: `touchedBy` moves on the first settle, so
 * after one the row could not go back to answering this. What the row does with the
 * answer is a layout decision and this is it.
 *
 * Null too for every line the run composed, which is the ordinary case in a full
 * basket and draws no caption rather than an empty one. Both nulls arrive here as
 * the same absent id, and both mean "there is nothing to say".
 *
 * A guest is visibly a guest, because {@link participantName} is what names them
 * here as it does everywhere else on this screen.
 *
 * @param ownName the reader's own account name, or null for a guest, exactly as
 *   {@link touchedCaption} takes it and for the same reason.
 */
export function addedCaption(
  line: BasketLine,
  people: ReadonlyMap<string, BasketParticipant>,
  translator: RokuTranslatorService,
  locale: string,
  meId: string | null,
  ownName: string | null = null
): string | null {
  if (line.createdBy === null || line.touchedBy !== null) {
    return null;
  }

  const name = participantName(people.get(line.createdBy), translator, locale, {
    ownName: line.createdBy === meId ? ownName : null,
  });
  // An id this basket's participant list does not hold, which is a participant
  // removed since the line was added. "Added by " with nothing after it is worse
  // than nothing, and the row is complete without it.
  return name === ''
    ? null
    : translator.t('basket.added.by', undefined, locale, { name });
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
