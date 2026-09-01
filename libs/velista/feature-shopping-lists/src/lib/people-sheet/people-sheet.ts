import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  type BasketParticipant,
} from '@portfolio/velista/models';
import {
  generatedListIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { participantName } from '../basket-labels';
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

  /** The basket underneath, which is where closing this sheet goes. */
  private readonly _generatedListId = generatedListIdOf(this._route);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _openId = signal<string | null>(null);
  private readonly _busy = signal(false);

  protected readonly busy = this._busy.asReadonly();
  protected readonly seesZoneData = this._store.seesZoneData;

  /** Whether the reader owns this basket, which is who may remove somebody. */
  protected readonly isOwner = computed(
    () => this._store.me()?.kind === 'OWNER'
  );

  /**
   * Everybody, in join order, each with what the row needs to draw itself.
   *
   * The label is resolved here rather than in the template because it has three
   * branches (a typed name, `Guest N`, and "you"), and a template that repeated
   * them would be the place the two copies drift.
   */
  protected readonly people = computed(() => {
    const meId = this._store.me()?.id ?? null;
    return this._store.participants().map((person) => ({
      person,
      label: participantName(person, this._translator, this._locale()),
      isGuest: person.kind === 'GUEST',
      isMe: person.id === meId,
      // Only a reader who passes the rule receives a device at all, so this is
      // the honest test for "is there a detail pane worth opening".
      inspectable: person.device !== undefined,
    }));
  });

  protected readonly openPerson = computed<BasketParticipant | null>(() => {
    const id = this._openId();
    return id === null
      ? null
      : this._store.participants().find((person) => person.id === id) ?? null;
  });

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

  /** The first two initials of a name, for the avatar. Never a whole name. */
  protected initials(label: string): string {
    return label.slice(0, 2);
  }

  protected inspect(person: BasketParticipant): void {
    if (person.device === undefined) {
      // Not merely a disabled control: guests do not get to inspect each other,
      // and there is nothing to show them if they did.
      return;
    }
    this._openId.set(person.id);
  }

  protected back(): void {
    this._openId.set(null);
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
      basketPath(this._locale(), this._basePath, this._generatedListId())
    );
  }
}
