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
} from '@portfolio/localization/rokutranslator-angular';
import {
  ItemNames,
  LineStore,
  ListStore,
  MemberNames,
  SessionStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  LINE_QUANTITY_MAX,
  type SettlementOutcome,
} from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  SheetNavigation,
  zoneIdOf,
} from '@portfolio/velista/platform';
import { QuantityStepper, SheetShell } from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';
import { indicatorsFor } from '../select-list-state';
import { selectLineDetail } from './select-line-detail';

/** Which of the sheet's two faces is showing. */
type Step = 'summary' | 'howMany';

/**
 * What the app knows about one line, and the only place a purchase is recorded
 * (velista plan 0043, sections 5.1 and 5.2).
 *
 * ## Why recording lives here and nowhere else
 *
 * Section 1.1 takes every marking control off the row. That is not the app forgetting
 * how to record a purchase, and the difference is the whole of section 5.2: without one
 * recorded purchase every history and estimate in this plan renders empty forever, and
 * the line page is a promise it cannot keep.
 *
 * So it is here, **two taps behind a deliberate open**, and never a swipe. Saying what
 * you bought is something you do standing still, once, having come back from a shop;
 * it is not something a thumb does in passing down an aisle. That distinction is the
 * plan, and putting the control anywhere quicker would undo it.
 *
 * ## The two faces
 *
 * The summary, and the how many step. One sheet rather than two because they are the
 * same gesture at two depths, and the second is a question the first asked: it arrives
 * prefilled with the whole outstanding quantity, because buying everything you asked
 * for is the ordinary case and typing a number you already know is friction.
 *
 * Buying fewer leaves the rest wanted, which is backend plan 0047 section 4.1 and is
 * what makes a basket workable across two shops in an afternoon.
 */
@Component({
  selector: 'lib-line-detail-sheet',
  imports: [RokuTranslatorPipe, SheetShell, QuantityStepper],
  templateUrl: './line-detail-sheet.html',
  styleUrl: './line-detail-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineDetailSheet {
  private readonly _lines = inject(LineStore);
  private readonly _lists = inject(ListStore);
  private readonly _names = inject(MemberNames);
  private readonly _itemNames = inject(ItemNames);
  private readonly _session = inject(SessionStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _localeStore = inject(RokuLocaleStore);
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);
  readonly lineId = lineIdOf(this._route);

  readonly step = signal<Step>('summary');
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  /** How many the how many step is offering to record. */
  readonly howMany = signal(1);

  /** Which product it will record, on a line carrying more than one. */
  readonly chosenItemId = signal<string | null>(null);

  readonly max = LINE_QUANTITY_MAX;

  /**
   * The history, fetched once when the sheet opens.
   *
   * Not in a resolver, because the sheet is useful before it arrives: the quantity, the
   * products and both buttons come off the line, which is already in the store. Only
   * the two history rows wait, and they say so by being absent rather than by holding
   * the sheet closed.
   */
  private readonly _load = effect(() => {
    const lineId = this.lineId();
    untracked(() => void this._lines.loadSettlements(lineId));
  });

  /**
   * The product names, from the catalog (velista plan 0047, section 1).
   *
   * Its own effect rather than part of the one above, because it depends on the line's
   * product set and not on the id: a set edited while the sheet is open resolves the
   * new product without the history being read again.
   *
   * Nothing waits for it. The chips draw with no names until it lands, and if it never
   * does, the sheet says the names could not be loaded and stays entirely usable: the
   * quantity, both buttons and the history are all off the line.
   */
  private readonly _loadNames = effect(() => {
    const itemIds = this._line()?.itemIds ?? [];
    untracked(() => void this._itemNames.ensure(itemIds));
  });

  private readonly _line = computed(() =>
    this._lines.linesIn(this.listId()).find((line) => line.id === this.lineId())
  );

  /** `DECIDE`, the same permission the reel follows: both say what the household has. */
  private readonly _canSettle = computed(() =>
    (
      this._lists
        .listsIn(this.zoneId())
        .find((list) => list.id === this.listId())?.myPermissions ?? []
    ).includes('DECIDE')
  );

  /**
   * Who is out buying this line, as a name.
   *
   * The claim comes off the line, exactly as the row's does (backend plan 0052,
   * section 4), so the header and the row it opened from cannot disagree about it.
   */
  private readonly _claimedByUserId = computed(() =>
    this._lines.claimOf(this.lineId())
  );

  readonly detail = computed(() => {
    const line = this._line();
    const claimedBy = this._claimedByUserId();

    return selectLineDetail({
      line,
      settlements: this._lines.settlementsOf(this.lineId()),
      // The catalog, through `ItemNames`, and never the fixture in `catalog-memory`
      // this used to read (section 1). Against a real catalog every one of its ids
      // missed, and this sheet told the reader their line had no products.
      itemNameOf: (itemId) => this._itemNames.nameOf(itemId),
      namesUnavailable: this._itemNames.anyFailed(line?.itemIds ?? []),
      nameOf: (userId) => this._names.nameOf(this.zoneId(), userId),
      callerUserId: this._session.userId(),
      locale: this._localeStore.locale(),
      canSettle: this._canSettle(),
      // The row's own indicators, from the row's own function, rather than the `[]`
      // this passed since 0043 (section 5). A row showing "bought" that opened a sheet
      // showing nothing was two answers to one question, a tap apart.
      indicators: line === undefined ? [] : indicatorsFor(line, claimedBy),
      claimedBy:
        claimedBy === null
          ? null
          : this._names.nameOf(this.zoneId(), claimedBy),
      busy: this.submitting(),
    });
  });

  /**
   * Open the how many step, prefilled.
   *
   * The whole outstanding quantity, floored at one: a line at zero can still be bought
   * (somebody restocked without being asked), and offering zero would be offering to
   * record nothing.
   */
  startBought(): void {
    const detail = this.detail();
    if (detail === null || !detail.canSettle) {
      return;
    }

    this.howMany.set(Math.max(1, detail.quantity));
    this.chosenItemId.set(detail.preselectedItemId);
    this.errorKey.set(null);
    this.step.set('howMany');
  }

  /** Which of the line's products was bought, when it carries more than one. */
  chooseItem(itemId: string): void {
    this.chosenItemId.set(itemId);
  }

  /** Record the purchase. */
  async recordBought(): Promise<void> {
    await this._settle('BOUGHT', this.howMany());
  }

  /**
   * Say the shop did not have it.
   *
   * Straight from the summary with no second step, because there is no number to ask
   * for: it records the trip and moves nothing (backend plan 0047, section 4). It sits
   * beside "I bought this" and carries the same weight for the same reason both are
   * here at all: it is something you say afterwards, not something you flick past.
   */
  async recordNotAvailable(): Promise<void> {
    await this._settle('NOT_AVAILABLE', undefined);
  }

  private async _settle(
    outcome: SettlementOutcome,
    quantity: number | undefined
  ): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    const chosen = this.chosenItemId();
    const result = await this._lines.settle(this.lineId(), outcome, {
      ...(quantity === undefined ? {} : { quantity }),
      // Only when the line carries a choice to make. With one product the server
      // copies it itself, and with none there is nothing to name.
      ...(chosen === null || this.detail()?.choices.length === 0
        ? {}
        : { itemId: chosen }),
    });

    this.submitting.set(false);

    if (result.state === 'failed') {
      this.errorKey.set(
        listErrorKey(result.error, 'lines.write') ?? 'list.detail.failed'
      );
      // Left on the step it failed on, with the number still filled in. Sending
      // somebody back to the summary would make them re-enter what they just typed.
      return;
    }

    await this.dismiss();
  }

  /** Back from the how many step to the summary, without leaving the sheet. */
  cancelStep(): void {
    this.step.set('summary');
    this.errorKey.set(null);
  }

  /**
   * Through to everything else, which is a page rather than a deeper sheet.
   *
   * `leaveTo` and **not** `dismiss`, which is the whole of a defect worth naming.
   * `dismiss` pops the history when the sheet was opened over a page, and it is right
   * to: cancelling has to give back the screen underneath, whatever it was, rather
   * than a URL this sheet guessed at. It ignores the URL it is handed to do that, so
   * asking it to go somewhere new sent every reader who tapped through from the list
   * straight back to the list, which is the one place they had just said they did not
   * want to be. This is not a dismissal. It is a destination, so it replaces the
   * sheet's entry with the page: back from there gives the list, and the spent sheet
   * is not sitting between the two.
   */
  async openPage(): Promise<void> {
    await this._sheet.leaveTo(
      appPath(
        this._localeStore.locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId(),
        'lines',
        this.lineId(),
        'detail'
      )
    );
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(
      appPath(
        this._localeStore.locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId()
      )
    );
  }
}
