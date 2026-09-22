import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  ContactStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  APP_STANDALONE_ORIGIN,
  formatVisitMoment,
  groupContacts,
  isLinkVisitor,
  isNamedPerson,
} from '@portfolio/velista/models';
import { BrowserFacade, SheetNavigation } from '@portfolio/velista/platform';
import {
  PeoplePicker,
  ShareIcon,
  SheetShell,
  type PeoplePickerToggle,
} from '@portfolio/velista/ui';
import { visitTime } from '../basket-labels';
import { basketPath, basketShareUrl } from '../basket-paths';

/** Which half of the sheet is showing: the link, or the question about revoking. */
type Pane = 'link' | 'revoke';

/**
 * Which of the things this sheet can say about the link (velista `0094`,
 * section 3).
 *
 * `working` and `ended` are decided by comparing the link's end with this
 * device's clock, which **chooses a sentence and grants nothing**: whether the
 * link works is the server's answer, given on every join, and this picks
 * between showing a URL and offering a new one. A phone whose clock is wrong
 * shows the wrong one of two honest screens, and the next press corrects it.
 *
 * `unknown` is the fourth, and the section's table has three because it
 * describes what the owner ends up reading rather than the moment before the
 * answer. It exists because **this sheet can be built before its basket has
 * been read**: under `shopping-lists/live` the id arrives with the basket
 * (velista `0091`), and a cold load on this sheet's own URL constructs it while
 * that read is still out. Without it the sheet would say "this list has no link
 * right now" about a basket it has not asked about, which is the one sentence
 * here that is a statement of fact rather than a state of the screen.
 */
type LinkState = 'unknown' | 'none' | 'working' | 'ended';

/**
 * The one link, and taking it back (plan 0044, section 5.2).
 *
 * ## Zero links or one, and opening this sheet makes none
 *
 * A basket starts with zero and a **press** gives it one; revoking returns it to
 * zero, and pressing again mints a fresh one. The one link can be copied again
 * at any time, from any of the owner's devices, because handing it to the next
 * person tomorrow must not depend on a string copied once (backend `0051`,
 * section 3.1). That is why the route is `PUT` and not `POST`: pressing share on
 * two devices produces one link, not two.
 *
 * **Opening the sheet used to mint**, on the reasoning that pressing share was
 * the gesture. Three things since made that wrong (velista `0094`, section 3). A
 * link is now a twelve hour invitation rather than a standing key, this sheet is
 * also where the owner ticks people onto the basket, and one of the two baskets
 * never ends. Somebody opening it to tick a flatmate would have minted an
 * invitation nobody asked for, live for twelve hours, on a basket that is always
 * there. So the constructor **reads**, and the primary button mints.
 *
 * ## An ended link is replaced, never revoked first
 *
 * "Make a new link" is the same `PUT` as "Make a link". The server revokes the
 * ended one and mints in the one call (backend `0140`, section 4), so there is
 * no two step here and no window in which the basket has no link because this
 * screen was between requests.
 *
 * ## Revoking asks a real question, and the default is the kind one
 *
 * **Revoking a link does not evict the people already shopping.** They keep
 * working and the same URL still opens the list for them, because their session
 * is what authorizes them and the link was only an invitation they already
 * accepted. That is the common intent, and a screen that silently kicked three
 * people out of a shop would be the worst possible reading of a one word button.
 *
 * So the cascade is a **separate, explicit tick** with its own sentence, defaulted
 * off, and the confirm button says what it does rather than saying "OK".
 *
 * ## The copied URL carries no locale
 *
 * `shareUrl` builds `{origin}{mount}/s/{secret}` and stops there. The recipient's
 * language is not knowable here, and `localeGuard` inserts theirs on arrival, so
 * baking the sender's in would open the app in the wrong language for exactly the
 * person it was sent to.
 *
 * ## Two ways to hand it over, and the second one is a phone's
 *
 * Copy is always there, because a URL on the clipboard goes anywhere. The share
 * control beside it opens the operating system's own sheet, which is how a link
 * actually reaches a group chat on the device this screen is used on, and it is
 * drawn only where `navigator.share` exists: a button that opens nothing is worse
 * than one that is absent. That is the treatment the invite card already gives the
 * group's link, and this is the same act on the other kind of link.
 */
@Component({
  selector: 'lib-share-sheet',
  imports: [RokuTranslatorPipe, PeoplePicker, ShareIcon, SheetShell],
  templateUrl: './share-sheet.html',
  styleUrl: './share-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareSheet {
  private readonly _store = inject(BasketStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _browser = inject(BrowserFacade);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _standaloneOrigin = inject(APP_STANDALONE_ORIGIN);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _contacts = inject(ContactStore);
  private readonly _zones = inject(ZoneStore);

  /**
   * The basket underneath, which is where closing this sheet goes.
   *
   * From the **store** and not from `paramMap` since velista `0091`: the same
   * page is routed at `shopping-lists/live`, where there is no id in the URL at
   * all, and a sheet that read one there would dismiss to `/shopping-lists/`.
   */
  private readonly _address = this._store.address;

  private readonly _pane = signal<Pane>('link');
  private readonly _busy = signal(false);
  private readonly _copied = signal(false);
  /**
   * Whether the link has been asked about at all yet.
   *
   * See {@link LinkState}'s `unknown`. It is set when a read comes back rather
   * than when one is sent, so the window it covers is the whole of "we do not
   * know", including the round trip.
   */
  private readonly _asked = signal(false);
  /** The basket the link was last read for, so the read happens once per basket. */
  private _readFor: string | null = null;

  protected readonly pane = this._pane.asReadonly();
  protected readonly busy = this._busy.asReadonly();
  protected readonly copied = this._copied.asReadonly();
  protected readonly link = this._store.shareLink;

  /** Whether the cascade is ticked. Off by default, and it stays a second choice. */
  protected readonly cascade = signal(false);

  /**
   * Whether to offer the operating system's share sheet at all.
   *
   * The Web Share API is a phone's and mostly is not a desktop's. Read through
   * `BrowserFacade` (rule D2) rather than off `navigator`, and read once: it is a
   * fact about the browser and does not change while this sheet is open.
   */
  protected readonly canShare =
    this._browser.window?.navigator.share !== undefined;

  /** How many people arrived through this link, for both panes' sentences. */
  protected readonly joinedCount = computed(
    () => this.link()?.participantCount ?? 0
  );

  /**
   * Which of the three link states the sheet is in (section 3).
   *
   * Recomputed whenever the link moves rather than on a timer. A sheet held open
   * across the moment its link ends keeps showing the URL until something else
   * redraws, and that is the harmless half of the trade: the server refuses the
   * join, the next press mints, and nothing here promised otherwise.
   */
  protected readonly linkState = computed<LinkState>(() => {
    if (!this._asked()) {
      return 'unknown';
    }
    const link = this.link();
    if (link === null) {
      return 'none';
    }
    return link.expiresAt.getTime() > Date.now() ? 'working' : 'ended';
  });

  /**
   * When the link stops accepting people, as a key and its arguments.
   *
   * Two keys rather than one interpolating a composed string, because the
   * sentence is built around the moment here rather than ending with it: "Works
   * until tomorrow, 07:15" and "Works until 18:40" are one sentence in two
   * shapes, and a language that orders them differently needs both written out.
   */
  protected readonly worksUntil = computed<{
    readonly key: string;
    readonly args: Readonly<Record<string, string | undefined>>;
  } | null>(() => {
    const link = this.link();
    if (link === null) {
      return null;
    }
    const moment = formatVisitMoment(link.expiresAt, this._locale());
    return moment.day === null
      ? { key: 'basket.share.worksUntil', args: { time: moment.time } }
      : {
          key: 'basket.share.worksUntilDay',
          args: { day: moment.day, time: moment.time },
        };
  });

  /**
   * The body of the sheet, which differs on the basket that is always there
   * (section 7).
   *
   * A `LIVE` basket's link hands over **every list the owner can write, now and
   * later**, rather than the lines of one trip, and the owner is owed that
   * sentence before they send it rather than after somebody has read a list
   * they did not mean to share.
   */
  protected readonly bodyKey = computed(() =>
    this._store.basket()?.kind === 'LIVE'
      ? 'basket.share.bodyLive'
      : 'basket.share.body'
  );

  /**
   * The URL to hand somebody.
   *
   * Built from the standalone origin rather than from wherever this tab happens
   * to be: velista is reachable at `ichirokuxvi.com/velista` and at
   * `velista.app`, and the link that goes into a group chat should be the app's
   * own address rather than the portfolio's.
   */
  protected readonly url = computed(() => {
    const secret = this.link()?.secret;
    return secret === undefined
      ? ''
      : basketShareUrl(
          this._standaloneOrigin || this._browser.window?.location.origin || '',
          this._basePath,
          secret
        );
  });

  // --- People (velista `0085`, section 4) ------------------------------------

  /**
   * Whether the reader owns the basket, which is who may add and remove people.
   *
   * Only the owner reaches this sheet, and the section still asks, because the routes
   * behind it refuse anybody else and a picker whose every tick fails is worse than
   * none.
   */
  protected readonly isOwner = computed(
    () => this._store.me()?.kind === 'OWNER'
  );

  /** People being added while the request is out, drawn ticked. */
  private readonly _adding = signal<ReadonlySet<string>>(new Set());
  /** People being removed while the request is out, drawn unticked. */
  private readonly _removing = signal<ReadonlySet<string>>(new Set());

  /** The key of the failure under the section, or null. */
  protected readonly peopleError = signal<string | null>(null);

  protected readonly contactGroups = computed(() => {
    const names = new Map(
      this._zones
        .myZones()
        .filter((zone) => zone.myStatus === 'APPROVED')
        .map((zone) => [zone.id, zone.name])
    );
    return groupContacts(this._contacts.contacts(), names, this._locale());
  });

  /**
   * The basket's **named** people, by user id (velista `0094`, section 3).
   *
   * Velista `0085` put every registered participant here, so somebody a link
   * let in showed ticked. That was right while a link joiner was on the basket
   * for good; since backend `0140` they are on it for twelve hours, and the tick
   * now means "stays until you untick them". A visitor is therefore **unticked**,
   * with a hint saying they are here and until when, and ticking them is what
   * keeps them.
   *
   * The owner is not in here and never was: nobody removes them, and the
   * promotion this map drives has nothing to offer somebody who owns the thing.
   */
  private readonly _members = computed(() => {
    const members = new Map<string, { id: string }>();
    for (const person of this._store.participants()) {
      if (person.userId !== null && isNamedPerson(person)) {
        members.set(person.userId, { id: person.id });
      }
    }
    return members;
  });

  /** The people on the basket by link, by user id, for the visiting hint. */
  private readonly _visitors = computed(() => {
    const visitors = new Map<string, Date>();
    for (const person of this._store.participants()) {
      if (person.userId !== null && isLinkVisitor(person)) {
        visitors.set(person.userId, person.expiresAt);
      }
    }
    return visitors;
  });

  /**
   * Who is ticked: everybody on the basket **by name**, plus the adds still out
   * and minus the removals still out.
   *
   * A failed save takes its person out of the pending set, so the box moves back
   * through its binding. That is the "puts the checkbox back" of section 4.
   */
  protected readonly ticked = computed<ReadonlySet<string>>(() => {
    const ticked = new Set(this._members().keys());
    for (const id of this._adding()) {
      ticked.add(id);
    }
    for (const id of this._removing()) {
      ticked.delete(id);
    }
    return ticked;
  });

  protected readonly savingPeople = computed<ReadonlySet<string>>(
    () => new Set([...this._adding(), ...this._removing()])
  );

  /**
   * The line under a contact who is on this basket **with the link**: that they
   * are already here, and until when.
   *
   * It replaces `share.people.linkJoined`, which warned that unticking such a
   * person stopped the link working for them. That sentence was about the old
   * meaning of the tick. What a link joiner needs said now is the opposite: they
   * are here temporarily, and the empty box beside their name is the thing that
   * would keep them.
   *
   * Already translated, unlike the keys this input used to carry, because the
   * sentence interpolates a time. The picker draws whatever string it is given.
   */
  protected readonly peopleHints = computed<ReadonlyMap<string, string>>(() => {
    const locale = this._locale();
    return new Map(
      [...this._visitors()].map(([userId, endsAt]) => [
        userId,
        this._translator.t('share.people.visiting', undefined, locale, {
          time: visitTime(endsAt, this._translator, locale),
        }),
      ])
    );
  });

  constructor() {
    /**
     * **Read, never mint.** A press is the gesture that gives a basket a link;
     * opening this sheet is not, since velista `0094` made a link a twelve hour
     * invitation and made this the screen the owner also ticks people on.
     *
     * Driven by the **basket's id appearing** rather than by this constructor,
     * and that is not a refinement: `BasketStore.loadShareLink` addresses the
     * basket by id and does nothing at all when it has none yet. Under
     * `shopping-lists/live` the id arrives with the basket (velista `0091`), so
     * a cold load on this sheet's URL builds it while that read is still out,
     * and a read fired from here would be dropped in silence. The sheet would
     * then sit on `none` for ever, telling the owner their list has no link and
     * offering a button that mints a second one.
     *
     * Guarded on the id it last read for, so the ordinary re-render does not
     * re-ask, and so moving between baskets would.
     */
    effect(() => {
      const id = this._store.basket()?.id ?? null;
      if (id === null || id === this._readFor) {
        return;
      }
      this._readFor = id;
      untracked(() => void this._read());
    });

    void this._zones.load();
    void this._contacts.load();

    // The joined count is the link's, and it moves whenever somebody on the basket
    // moves: keeping a visitor turns them into a named person, and a removal takes
    // one away. The participants follow the answers and the socket, so the count
    // follows them. The first run is skipped, because the read above answers it.
    let first = true;
    effect(() => {
      this._store.participants();
      if (first) {
        first = false;
        return;
      }
      if (untracked(() => this.link()) !== null) {
        void this._store.loadShareLink();
      }
    });
  }

  /**
   * A tick saves at once. There is no Save button (velista `0085`, section 4).
   *
   * **Ticking somebody who is here with the link keeps them**, and it is the
   * same call: the server answers `POST participants` on a live link visitor by
   * promoting the row they already have, clearing its expiry and its link
   * (backend `0140`, section 6). So this file has one add, the hint goes when
   * the participants are read again, and the person's past attributions survive
   * because the row kept its id.
   */
  protected async togglePerson(toggle: PeoplePickerToggle): Promise<void> {
    this.peopleError.set(null);
    const { userId } = toggle;

    if (toggle.selected) {
      this._adding.update((held) => new Set(held).add(userId));
      const saved = await this._store.addParticipant(userId);
      this._adding.update((held) => without(held, userId));
      if (!saved) {
        this.peopleError.set('share.people.failed');
      }
      return;
    }

    const member = this._members().get(userId);
    if (member === undefined) {
      return;
    }
    this._removing.update((held) => new Set(held).add(userId));
    try {
      await this._store.removeParticipant(member.id);
    } catch {
      this.peopleError.set('share.people.failed');
    } finally {
      this._removing.update((held) => without(held, userId));
    }
  }

  /**
   * Make the link, from "Make a link" and from "Make a new link".
   *
   * One method for both, because it is one request. The server revokes an ended
   * link and mints in the same `PUT` (backend `0140`, section 4), so this never
   * revokes first: a client that did would leave the basket linkless for a round
   * trip, and would fail halfway there.
   */
  protected async makeLink(): Promise<void> {
    this._busy.set(true);
    await this._store.share();
    // The answer is a link, so the sheet knows either way from here on.
    this._asked.set(true);
    this._busy.set(false);
  }

  /** Read the live link, and record that the question has been asked. */
  private async _read(): Promise<void> {
    await this._store.loadShareLink();
    this._asked.set(true);
  }

  protected async copy(): Promise<void> {
    const url = this.url();
    if (url === '') {
      return;
    }
    await this._browser.window?.navigator.clipboard?.writeText(url);
    this._copied.set(true);
  }

  /**
   * Hand the link to the operating system's share sheet.
   *
   * Falls back to copying when the API is missing, which is what makes the control
   * safe to offer at all, and swallows a rejection: dismissing the system sheet
   * rejects, and a dismissal is not a failure worth a sentence. Nothing is claimed
   * either way, because this screen cannot know where the link went.
   *
   * The URL alone, as the invite card's share already does: the system sheet reads
   * the page it is handed, and a title written here would be this app's words
   * appearing inside somebody else's message.
   */
  protected async share(): Promise<void> {
    const url = this.url();
    if (url === '') {
      return;
    }

    const navigator = this._browser.window?.navigator;
    if (navigator?.share === undefined) {
      await this.copy();
      return;
    }

    try {
      await navigator.share({ url });
    } catch {
      // Dismissed, or refused. The link is still on screen and still copyable.
    }
  }

  protected askRevoke(): void {
    this.cascade.set(false);
    this._pane.set('revoke');
  }

  protected async revoke(): Promise<void> {
    this._busy.set(true);
    await this._store.revokeLink(this.cascade());
    this._busy.set(false);
    this.close();
  }

  protected keepIt(): void {
    this._pane.set('link');
  }

  /**
   * Cancel, Escape, the scrim, the back button, and a revoke that went through.
   *
   * The basket's whole URL, through `SheetNavigation`, like every other sheet in
   * the app: a relative `..` climbs one segment of whatever path the sheet
   * happens to sit on, which is a fact about the route table that changes without
   * this file being touched, and an ordinary `navigate` pushes, leaving the sheet
   * one back press from reopening (plan 0031).
   */
  protected close(): void {
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._address())
    );
  }
}

/** A copy of a set without one member. */
function without(held: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(held);
  next.delete(id);
  return next;
}
