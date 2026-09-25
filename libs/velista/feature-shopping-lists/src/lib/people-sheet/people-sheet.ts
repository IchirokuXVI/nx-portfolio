import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, SessionStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  formatGeneratedDate,
  isLinkVisitor,
  type BasketParticipant,
} from '@portfolio/velista/models';
import { appPath, SheetNavigation } from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import {
  participantInitials,
  participantName,
  visitTime,
} from '../basket-labels';
import { basketPath } from '../basket-paths';

/**
 * Who is on this basket, and what is known about one of them (plan 0044,
 * section 5.1).
 *
 * ## Guests and registered people in one list
 *
 * One list, in join order, with guests **marked as such**. There is deliberately
 * no separate section for them and no sentence anywhere: "three anonymous users
 * are shopping with you" was considered and dropped for being a paragraph where a
 * row of faces does the job.
 *
 * **The word "anonymous" appears nowhere in this product.** They are guests.
 *
 * ## A name is not an identity
 *
 * A guest's `displayName` is unverified text typed on an unauthenticated link,
 * and two guests can both type "Dani". So both rows stay, both are marked as
 * guests, and nothing here is keyed by a name: the participant id is the
 * identity, and the name is for reading (backend `0051`, section 3.5).
 *
 * The mark is a **dashed ring and a word**, never colour alone (section 7).
 *
 * ## The detail pane is not for everybody
 *
 * Tapping a row shows the device and the join time, which is zone-adjacent data
 * the server sends only to a reader who passes the all or nothing rule. It is
 * absent rather than null for everybody else, so the pane simply has nothing to
 * draw, and the row is not tappable for them at all: guests do not get to inspect
 * each other.
 *
 * ## Leaving
 *
 * A registered participant who does not own the basket can always open their **own**
 * row, whatever the server sent about devices, because that pane is where "Leave this
 * list" lives (velista `0085`, section 7). It asks first, in a second pane of the same
 * sheet, and a confirmed leave goes to the Shared lists tab of the history. A guest
 * never sees it: the server refuses a guest leaving, and a guest has no tab to go to.
 */
@Component({
  selector: 'lib-people-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './people-sheet.html',
  styleUrl: './people-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeopleSheet {
  private readonly _store = inject(BasketStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);

  /**
   * The basket underneath, which is where closing this sheet goes.
   *
   * From the **store** and not from `paramMap` since velista `0091`: the same
   * page is routed at `shopping-lists/live`, where there is no id in the URL at
   * all, and a sheet that read one there would dismiss to `/shopping-lists/`.
   */
  private readonly _address = this._store.address;
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  /** The account, for the owner's own row, which the basket carries unnamed. */
  private readonly _session = inject(SessionStore);

  private readonly _injector = inject(Injector);

  private readonly _openId = signal<string | null>(null);
  private readonly _busy = signal(false);
  /** Whether the open pane is the leave question rather than the person. */
  private readonly _askingLeave = signal(false);

  protected readonly askingLeave = this._askingLeave.asReadonly();

  /** The key of the failure under the leave question, or null. */
  protected readonly leaveError = signal<string | null>(null);

  private readonly _question =
    viewChild<ElementRef<HTMLElement>>('leaveQuestion');

  protected readonly busy = this._busy.asReadonly();
  protected readonly seesDevices = computed(() =>
    this._store.participants().some((person) => 'device' in person)
  );

  /** Whether the reader owns this basket, which is who may remove somebody. */
  protected readonly isOwner = computed(
    () => this._store.me()?.kind === 'OWNER'
  );

  /**
   * Whether the reader may leave: a registered participant, which is neither the
   * owner, who cannot hand the basket on, nor a guest, whom the server refuses.
   */
  protected readonly canLeave = computed(
    () => this._store.me()?.kind === 'REGISTERED'
  );

  /**
   * The basket's name for the leave question, as every screen names it: its own name,
   * or the day it was made when it has none.
   */
  protected readonly basketName = computed(() => {
    const basket = this._store.basket();
    if (basket === null) {
      return '';
    }
    if (basket.name !== null && basket.name !== '') {
      return basket.name;
    }
    return basket.createdAt === null
      ? ''
      : formatGeneratedDate(basket.createdAt, this._locale());
  });

  /**
   * Everybody, in join order, each with what the row needs to draw itself.
   *
   * The label is resolved here rather than in the template because it has three
   * branches (a typed name, `Guest N`, and "you"), and a template that repeated
   * them would be the place the two copies drift.
   */
  protected readonly people = computed(() => {
    const meId = this._store.me()?.id ?? null;
    const ownName = this._session.username();
    const locale = this._locale();

    return this._store.participants().map((person) => {
      // Core keeps no `displayName` for an owner, so without their account name the
      // person who made the basket was listed on it as "Guest", beside the actual
      // guests, and every bubble on the sheet drew the same two letters.
      const naming = { ownName: person.id === meId ? ownName : null };

      return {
        person,
        label: participantName(person, this._translator, locale, naming),
        initials: participantInitials(person, this._translator, locale, naming),
        isGuest: person.kind === 'GUEST',
        isMe: person.id === meId,
        /**
         * When this person's visit ends, formatted, or null for the owner and
         * for anybody added by name (velista `0094`, section 6).
         *
         * Resolved here rather than in the template, where the rest of this
         * row's strings are, and for the same reason: it is `Intl` work that
         * needs the locale, and a template that did it per row would be doing
         * it on every redraw of the sheet.
         */
        until: isLinkVisitor(person)
          ? visitTime(person.expiresAt, this._translator, locale)
          : null,
        // Only a reader who passes the rule receives a device at all, so this is
        // the honest test for "is there a detail pane worth opening". The one
        // exception is a member's own row, which holds the way to leave.
        inspectable:
          person.device !== undefined ||
          (person.id === meId && this.canLeave()),
      };
    });
  });

  protected readonly openPerson = computed<BasketParticipant | null>(() => {
    const id = this._openId();
    return id === null
      ? null
      : (this._store.participants().find((person) => person.id === id) ?? null);
  });

  /** The open person's name, drawn exactly as their row draws it. */
  protected readonly openLabel = computed(() => {
    const id = this._openId();
    return this.people().find((row) => row.person.id === id)?.label ?? '';
  });

  /**
   * The open person's own row, as the list drew it, or null.
   *
   * The pane reads this rather than {@link openPerson} for anything the row
   * already worked out, which is how the two can never disagree about when
   * somebody's visit ends.
   */
  private readonly _openRow = computed(() => {
    const id = this._openId();
    return this.people().find((row) => row.person.id === id) ?? null;
  });

  /** When the open person's visit ends, formatted, or null. */
  protected readonly openUntil = computed(() => this._openRow()?.until ?? null);

  /**
   * Whether the owner is offered "Keep on this list" over the open person
   * (velista `0094`, section 6).
   *
   * Three conditions, and the third is the one worth stating. The reader has to
   * be the owner, the person has to be here on the link rather than by name,
   * **and they have to have an account**: keeping somebody is adding them by
   * name, and a guest has no name to be added by. The server waives its contact
   * rule for a live link visitor precisely so this control works on somebody
   * outside every group of the owner's (backend `0140`, section 6).
   */
  protected readonly canKeep = computed(() => {
    const person = this.openPerson();
    return (
      this.isOwner() &&
      person !== null &&
      isLinkVisitor(person) &&
      person.userId !== null
    );
  });

  /**
   * Whether the owner is being told that a guest cannot be kept.
   *
   * Said **to the owner only**, and that is rule C2 doing its work from the
   * other side: the sentence is about what an account would allow, and a guest
   * reading it about themselves is an invitation to register in all but name.
   */
  protected readonly showsGuestCannotStay = computed(() => {
    const person = this.openPerson();
    return (
      this.isOwner() &&
      person !== null &&
      isLinkVisitor(person) &&
      person.userId === null
    );
  });

  /** The key of a failed keep, under the button, or null. */
  protected readonly keepError = signal<string | null>(null);

  /**
   * Which leave question the reader is asked (velista `0094`, section 6).
   *
   * A named person cannot come back on their own: the link would not make them
   * one again, so only the owner adding them does. A visitor can, for as long
   * as the link they came by still works. Two facts, two sentences, chosen from
   * the reader's own row rather than from the basket.
   */
  protected readonly leaveQuestionKey = computed(() => {
    const me = this._store.me();
    return me !== null && isLinkVisitor(me)
      ? 'basket.people.leaveVisitor'
      : 'basket.people.leaveNamed';
  });

  /**
   * Keep the open person on this list, which is the owner promoting them.
   *
   * The same call the picker's tick makes. The row becomes a named person
   * through the store's ordinary participant read, so nothing here patches it:
   * `canKeep` goes false on its own and the button with it.
   */
  protected async keep(): Promise<void> {
    const userId = this.openPerson()?.userId;
    if (userId === undefined || userId === null) {
      return;
    }

    this._busy.set(true);
    this.keepError.set(null);
    const kept = await this._store.addParticipant(userId);
    this._busy.set(false);
    if (!kept) {
      // The pane stays where it is, with the sentence under the button that was
      // pressed: the person is still on the basket and still visiting.
      this.keepError.set('basket.people.keepFailed');
    }
  }

  /** Whether the open pane is the reader's own row and they may leave from it. */
  protected readonly offersLeave = computed(
    () =>
      this.canLeave() &&
      this._openId() !== null &&
      this._openId() === this._store.me()?.id
  );

  /**
   * When the open participant joined, in the reader's language.
   *
   * `Intl` rather than `DatePipe`, which is this library's convention and
   * `formatDay`'s reason: the pipe needs `registerLocaleData` per locale and a
   * `LOCALE_ID` this app does not set, because the language is runtime state
   * rather than the shell's build time locale. Resolved here, where the locale
   * already is, rather than in the template.
   *
   * A date **and** a time, unlike a settlement history's day: "joined today,
   * 10:41" is what tells somebody whether the person on this row is the one they
   * just sent the link to, which is the question the sheet is open to answer.
   */
  protected readonly joinedAt = computed<string | null>(() => {
    const at = this.openPerson()?.joinedAt ?? null;
    if (at === null) {
      return null;
    }
    const locale = this._locale();
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(at);
    } catch {
      // An unrecognised tag, which `Intl` throws a `RangeError` for. The ISO
      // string is ugly and correct, and a row with no time would be worse.
      return at.toISOString();
    }
  });

  protected inspect(person: BasketParticipant): void {
    const ownRow = person.id === this._store.me()?.id && this.canLeave();
    if (person.device === undefined && !ownRow) {
      // Not merely a disabled control: guests do not get to inspect each other,
      // and there is nothing to show them if they did.
      return;
    }
    this._openId.set(person.id);
  }

  protected back(): void {
    this._openId.set(null);
  }

  /** Ask before leaving, and put focus on the question (section 9). */
  protected askLeave(): void {
    this.leaveError.set(null);
    this._askingLeave.set(true);
    afterNextRender(() => this._question()?.nativeElement.focus(), {
      injector: this._injector,
    });
  }

  protected stay(): void {
    this.leaveError.set(null);
    this._askingLeave.set(false);
  }

  /**
   * Leave the basket, then go to the baskets shared with the reader.
   *
   * `leaveTo` and not `dismiss`: the basket underneath is one the reader can no longer
   * open, so popping back onto it would draw its revoked notice at somebody who chose
   * to go.
   */
  protected async leave(): Promise<void> {
    this._busy.set(true);
    this.leaveError.set(null);
    const left = await this._store.leaveBasket();
    if (!left) {
      this._busy.set(false);
      this.leaveError.set('basket.people.leaveFailed');
      return;
    }
    await this._sheet.leaveTo(
      `${appPath(this._locale(), this._basePath, 'shopping-lists')}?tab=shared`
    );
  }

  /** Remove one participant and nobody else: the lost phone (section 5.2). */
  protected async remove(participantId: string): Promise<void> {
    this._busy.set(true);
    await this._store.removeParticipant(participantId);
    this._busy.set(false);
    this._openId.set(null);
  }

  /**
   * Cancel, Escape, the scrim and the back button all arrive here.
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
