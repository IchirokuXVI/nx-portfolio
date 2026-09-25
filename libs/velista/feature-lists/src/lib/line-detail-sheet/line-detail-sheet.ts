import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BoughtShopMemory,
  GatewayError,
  ItemNames,
  LineStore,
  ListStore,
  MemberNames,
  REALTIME_CLIENT,
  SessionStore,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  LINE_CONTENT_MAX_LENGTH,
  LINE_QUANTITY_MAX,
  type BasketShop,
  type SettlementOutcome,
} from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  SheetNavigation,
  sheetSegments,
  zoneIdOf,
} from '@portfolio/velista/platform';
import {
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  CommentIcon,
  QuantityReel,
  QuantityStepper,
  SheetShell,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { LineGoneNotice, watchLineGone } from '../line-gone/line-gone';
import { listErrorKey } from '../list-error-copy';
import {
  actionsFor,
  editScopeFor,
  indicatorsFor,
  selectAbilities,
} from '../select-list-state';
import { BoughtShopPane } from './bought-shop-pane';
import { selectLineDetail } from './select-line-detail';

/**
 * Which of the sheet's faces is showing. `shop` is the how many step's own picker
 * (velista `0114`), a pane in its place rather than a sheet over it.
 */
type Step = 'summary' | 'howMany' | 'shop';

/**
 * The merge question, as the refusal stated it (velista plan 0083, section 5).
 *
 * `total` is worked out here rather than sent, from the amount the save carried and
 * the other line's, capped as the server caps the sum (backend plan 0112, section 3).
 */
export interface MergeQuestion {
  readonly other: string;
  readonly otherQuantity: number;
  readonly total: number;
}

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
 *
 * ## It is also where a line is changed (velista plan 0083)
 *
 * The row's three dots menu and the edit sheet behind it are gone. A reader who may
 * edit gets the name and the amount at the top of this sheet, with a Save button, and
 * everybody gets Comments, and Delete line when they may delete. Four rules hold it
 * together:
 *
 * - **Save is explicit.** Nothing is written while typing or on blur. It sends only
 *   the fields that changed, because a writer may not name the quantity of an approved
 *   line at all, even unchanged (backend plan 0076, section 3).
 * - **A rename onto a taken name asks first.** The server refuses it with the other
 *   line's name and amount, the sheet asks in a pane in place of its content, and Merge
 *   repeats the save with `confirmMerge`. The earlier line survives, so a merge can
 *   leave this line's id behind, and the sheet follows the survivor with `leaveTo`.
 * - **While a save is in flight nothing else writes.** Two writes to one line never
 *   race, and the shell refuses to close.
 * - **Comments and delete are pushed**, with `navigateByUrl`, so that closing them
 *   pops back here. `leaveTo` would replace this sheet's entry and closing them would
 *   land on the list.
 */
@Component({
  selector: 'lib-line-detail-sheet',
  imports: [
    RokuTranslatorPipe,
    SheetShell,
    QuantityStepper,
    QuantityReel,
    SpinnerIcon,
    CheckIcon,
    ChevronRightIcon,
    CloseIcon,
    CommentIcon,
    LineGoneNotice,
    BoughtShopPane,
  ],
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
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _localeStore = inject(RokuLocaleStore);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _injector = inject(Injector);
  private readonly _boughtShop = inject(BoughtShopMemory);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);
  readonly lineId = lineIdOf(this._route);

  readonly step = signal<Step>('summary');
  /** Why the last settle failed, drawn above the settle actions. */
  readonly errorKey = signal<string | null>(null);

  /** Why the last save was refused, drawn under Save (section 4). */
  readonly saveErrorKey = signal<string | null>(null);
  /** The arguments `saveErrorKey` interpolates, when it has any. */
  readonly saveErrorArgs = signal<Record<string, number> | undefined>(
    undefined
  );

  /** A settle request is out. */
  private readonly _settling = signal(false);

  /** A save is out. Everything else on the sheet waits for it (section 7). */
  readonly saving = signal(false);

  /** Either write is out, which is what keeps the sheet from closing under it. */
  readonly submitting = computed(() => this._settling() || this.saving());

  readonly maxLength = LINE_CONTENT_MAX_LENGTH;

  /** What the name field holds. */
  readonly name = signal('');

  /** What the amount holds. Only moves in `full` scope. */
  readonly amount = signal(0);

  /** Whether the last save landed and nothing has changed since (section 4). */
  readonly saved = signal(false);

  /** The merge question, while it is being asked. */
  readonly merge = signal<MergeQuestion | null>(null);

  /** Following the survivor of a merge, which is this sheet leaving on purpose. */
  private readonly _leaving = signal(false);

  /**
   * The line going away under the sheet (velista plan 0083).
   *
   * Quietly for the reader's own delete, which is how back after a delete lands on the
   * list rather than on this sheet. With a sentence when somebody else deleted it, or
   * when the URL named a line that is not on the list. Held while a save or a merge is
   * out, because a merge marks this line gone and follows the survivor itself.
   */
  readonly gone = watchLineGone({
    listId: this.listId,
    lineId: this.lineId,
    close: () => this.dismiss(),
    paused: computed(() => this.saving() || this._leaving()),
  });

  private readonly _saveButton =
    viewChild<ElementRef<HTMLButtonElement>>('saveButton');
  private readonly _question = viewChild<ElementRef<HTMLElement>>('question');
  private readonly _title = viewChild<ElementRef<HTMLElement>>('title');

  /** Whether this client is announcing itself as editing the line. */
  private _announcing = false;

  /**
   * The line as the fields last drew it.
   *
   * A realtime update to the line redraws the fields only while they still hold these
   * values, so an update never overwrites what the reader typed (section 4).
   */
  private _shown: { content: string; quantity: number } | null = null;

  /** How many the how many step is offering to record. */
  readonly howMany = signal(1);

  /** Which product it will record, on a line carrying more than one. */
  readonly chosenItemId = signal<string | null>(null);

  readonly max = LINE_QUANTITY_MAX;

  /**
   * Where it was bought, or null for not saying (velista `0114`).
   *
   * Optional in every sense: the step starts on the last shop this device named and
   * on nothing when there is none, it can be cleared, and a purchase with no shop is
   * recorded exactly as it was before the question existed.
   */
  readonly chosenShop = signal<BasketShop | null>(null);

  /** The chosen shop as the step's row prints it: the chain, then its own name. */
  readonly chosenShopName = computed(() => {
    const shop = this.chosenShop();
    if (shop === null) {
      return null;
    }
    const locale = this._localeStore.locale();
    const chain = catalogName(shop.chain, locale);
    const label = shop.label === null ? '' : catalogName(shop.label, locale);
    return label === '' || label === chain ? chain : `${chain} ${label}`;
  });

  /** The chosen shop's street and town, under its name, when the catalog has them. */
  readonly chosenShopWhere = computed(() => {
    const shop = this.chosenShop();
    const where = [shop?.address ?? null, shop?.city ?? null]
      .filter((part): part is string => part !== null && part.trim() !== '')
      .join(', ');
    return where === '' ? null : where;
  });

  private readonly _shopRow =
    viewChild<ElementRef<HTMLButtonElement>>('shopRow');

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

  private readonly _list = computed(() =>
    this._lists.listsIn(this.zoneId()).find((list) => list.id === this.listId())
  );

  private readonly _abilities = computed(() =>
    selectAbilities(this._list()?.myPermissions ?? [])
  );

  /**
   * `WRITE`, since backend plan 0131: the list page and the basket now ask one
   * rule who may record a purchase, and a `WRITE` holder already settled the same
   * line from the basket. Approving, and moving an approved quantity, keep
   * `DECIDE`, which is why the reel does not follow this.
   */
  private readonly _canSettle = computed(
    () => this._abilities().canWrite || this._abilities().canManage
  );

  /**
   * Which fields this reader may change on this line, or null for none.
   *
   * `editScopeFor`, the one expression the edit sheet asked before it was deleted, so
   * the fields and the server's refusal cannot disagree.
   */
  readonly scope = computed(() => {
    const line = this._line();
    return line === undefined ? null : editScopeFor(line, this._abilities());
  });

  /** Whether Delete line is drawn. */
  readonly canDelete = computed(() => {
    const line = this._line();
    return (
      line !== undefined &&
      actionsFor(line, this._abilities()).includes('delete')
    );
  });

  /** The line's comment count, the same number its row shows. */
  readonly commentCount = computed(() =>
    this._lines.commentCountOf(this.lineId())
  );

  /** Whether the name or the amount differs from the line as it now stands. */
  readonly changed = computed(() => {
    const line = this._line();
    if (line === undefined || this.scope() === null) {
      return false;
    }
    return (
      this.name().trim() !== line.content ||
      (this.scope() === 'full' && this.amount() !== line.quantity)
    );
  });

  readonly canSave = computed(
    () => this.changed() && this.name().trim() !== '' && !this.submitting()
  );

  /**
   * Whether to say that the save will put the line back to awaiting approval (plan
   * 0066, section 3), once there is something to save.
   *
   * `content` scope is exactly a writer on an approved line who holds neither `DECIDE`
   * nor `MANAGE`, which is two thirds of the server's condition. The third is that the
   * list does not approve lines by itself.
   */
  readonly warnsAboutUnapproval = computed(
    () =>
      this.changed() &&
      this.scope() === 'content' &&
      !(this._list()?.autoApproveLines ?? false)
  );

  /**
   * Seeds the fields from the line, and redraws them when the line changes under a
   * reader who has not touched them.
   */
  private readonly _seed = effect(() => {
    const line = this._line();
    // Not while a save is out. The store renames the row as the request leaves and
    // puts the old name back on a refusal, and neither is an update from somebody
    // else: redrawing from them would replace what the reader typed with the old name
    // the moment a merge question is asked. The effect runs again when the save ends,
    // against the line as it then stands.
    if (line === undefined || this.saving()) {
      return;
    }

    untracked(() => {
      const shown = this._shown;
      const name = this.name();
      const amount = this.amount();
      const matchesLine = name === line.content && amount === line.quantity;
      const clean =
        shown === null ||
        matchesLine ||
        (name === shown.content && amount === shown.quantity);

      if (clean) {
        this.name.set(line.content);
        this.amount.set(line.quantity);
        this._shown = { content: line.content, quantity: line.quantity };
      }
    });
  });

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

  constructor() {
    // The announcement ends with the component, however the sheet closed. The route's
    // services are never destroyed, so this is the one hook every exit reaches.
    inject(DestroyRef).onDestroy(() => this._stopEditing());
  }

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
    // The shop this device named last, while it is still the same trip.
    this.chosenShop.set(this._boughtShop.read());
    this._clearError();
    this.step.set('howMany');
  }

  /** Which of the line's products was bought, when it carries more than one. */
  chooseItem(itemId: string): void {
    this.chosenItemId.set(itemId);
  }

  /** Open the shop picker in place of the step. */
  openShop(): void {
    if (this.submitting()) {
      return;
    }
    this.step.set('shop');
  }

  /** A shop was chosen: keep it, remember it for next time, and go back to the step. */
  onShopPicked(shop: BasketShop): void {
    this.chosenShop.set(shop);
    this._boughtShop.remember(shop);
    this._backToStep();
  }

  /** Back from the picker with the choice as it was. */
  closeShop(): void {
    this._backToStep();
  }

  /** Say no shop, and stop offering the last one. */
  clearShop(): void {
    this.chosenShop.set(null);
    this._boughtShop.forget();
    afterNextRender(() => this._shopRow()?.nativeElement.focus(), {
      injector: this._injector,
    });
  }

  private _backToStep(): void {
    this.step.set('howMany');
    // The row that opened the picker, so the next Tab reaches Record it.
    afterNextRender(() => this._shopRow()?.nativeElement.focus(), {
      injector: this._injector,
    });
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

    this._settling.set(true);
    this._clearError();

    const chosen = this.chosenItemId();
    const shop = outcome === 'BOUGHT' ? this.chosenShop() : null;
    const result = await this._lines.settle(this.lineId(), outcome, {
      ...(quantity === undefined ? {} : { quantity }),
      // Only a place (velista `0114`). The server works out the price scope and
      // the price from it, and records no shop when it cannot.
      ...(shop === null ? {} : { supermarketLocationId: shop.id }),
      // Only when the line carries a choice to make. With one product the server
      // copies it itself, and with none there is nothing to name.
      ...(chosen === null || this.detail()?.choices.length === 0
        ? {}
        : { itemId: chosen }),
    });

    this._settling.set(false);

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

  /**
   * The name field was typed into.
   *
   * Any change takes the saved state back to Save, and a change is also what starts
   * announcing the edit when focus did not (section 7).
   */
  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.saved.set(false);
  }

  /**
   * The number under the thumb while the reel is worked, so a save that lands inside
   * the reel's idle beat sends what is on screen. The reel moving is also the other
   * thing that announces the edit (section 7).
   */
  onAmountPreview(next: number | null): void {
    if (next === null) {
      return;
    }
    this.startEditing();
    if (next !== this.amount()) {
      this.amount.set(next);
      this.saved.set(false);
    }
  }

  onAmountCommitted(to: number): void {
    this.startEditing();
    if (to !== this.amount()) {
      this.amount.set(to);
      this.saved.set(false);
    }
  }

  /** Tell the others this line is being edited. Once per stretch of editing. */
  startEditing(): void {
    if (this._announcing) {
      return;
    }
    this._announcing = true;
    this._realtime.setEditingLine(this.listId(), this.lineId());
  }

  /**
   * Focus left the fields. With nothing changed there is nothing being edited, so the
   * announcement stops; with a change it stands until the save.
   */
  onFieldsFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    const fields = event.currentTarget as HTMLElement | null;
    if (next !== null && fields?.contains(next)) {
      return;
    }
    if (!this.changed()) {
      this._stopEditing();
    }
  }

  /** Save the name and the amount (section 4). */
  async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    await this._save(false);
  }

  /** Merge, from the question (section 5). */
  async confirmMerge(): Promise<void> {
    if (this.submitting()) {
      return;
    }
    await this._save(true);
  }

  /** Back to the fields from the question, with what was typed still in them. */
  keepEditing(): void {
    this.merge.set(null);
    afterNextRender(() => this._saveButton()?.nativeElement.focus(), {
      injector: this._injector,
    });
  }

  private async _save(confirmMerge: boolean): Promise<void> {
    const line = this._line();
    const scope = this.scope();
    if (line === undefined || scope === null) {
      return;
    }

    const content = this.name().trim();
    const quantity = this.amount();
    // Only what changed. In `content` scope the quantity is never sent, because the
    // server refuses a body naming it on an approved line even when it is unchanged.
    const changes = {
      ...(content !== line.content ? { content } : {}),
      ...(scope === 'full' && quantity !== line.quantity ? { quantity } : {}),
      ...(confirmMerge ? { confirmMerge: true } : {}),
    };

    this.saving.set(true);
    this._clearError();

    const outcome = await this._lines.updateLine(this.lineId(), changes);

    if (outcome.state !== 'failed' && outcome.line.id !== this.lineId()) {
      // Before `saving` drops, so the watch never sees this line gone and unheld.
      this._leaving.set(true);
    }
    this.saving.set(false);

    if (outcome.state === 'failed') {
      this._refused(outcome.error, scope === 'full' ? quantity : line.quantity);
      return;
    }

    this.merge.set(null);
    this.saved.set(true);
    this._stopEditing();
    // From the answer, not from what was typed: a merge sums the two amounts and keeps
    // the survivor's own spelling, so the fields must show the line as it now stands.
    this.name.set(outcome.line.content);
    this.amount.set(outcome.line.quantity);
    this._shown = {
      content: outcome.line.content,
      quantity: outcome.line.quantity,
    };

    if (outcome.line.id !== this.lineId()) {
      // This line was the one absorbed. The survivor is the line that remains, so the
      // reader stays on it rather than on a sheet about a line that is gone. The router
      // reuses this component for the survivor's URL, so the hold ends here.
      await this._sheet.leaveTo(this._lineUrl(outcome.line.id, 'detail'));
      this._leaving.set(false);
    }

    if (confirmMerge) {
      // The pane that held the focused button is gone. Focus goes to the sheet's title,
      // which keeps it inside the dialog, where Escape and Tab still work.
      afterNextRender(() => this._title()?.nativeElement.focus(), {
        injector: this._injector,
      });
    }
  }

  /** What a refused save draws (sections 4 and 5). */
  private _refused(error: unknown, amount: number): void {
    const question = mergeQuestionOf(error, amount);
    if (question !== null) {
      this.merge.set(question);
      afterNextRender(() => this._question()?.nativeElement.focus(), {
        injector: this._injector,
      });
      return;
    }

    this.merge.set(null);
    this.saveErrorKey.set(
      listErrorKey(error, 'lines.write') ?? 'list.detail.failed'
    );
    const max = maxOf(error);
    this.saveErrorArgs.set(max === null ? undefined : { max });
  }

  private _clearError(): void {
    this.errorKey.set(null);
    this.saveErrorKey.set(null);
    this.saveErrorArgs.set(undefined);
  }

  private _stopEditing(): void {
    if (!this._announcing) {
      return;
    }
    this._announcing = false;
    this._realtime.setEditingLine(this.listId(), null);
  }

  /**
   * Open the line's comments over this sheet.
   *
   * `navigateByUrl`, which pushes, and **not** `leaveTo`, which would replace this
   * sheet's entry: the comments sheet dismisses by popping, and popping has to land
   * back here (section 6).
   */
  async openComments(): Promise<void> {
    if (this.saving()) {
      return;
    }
    await this._router.navigateByUrl(this._lineUrl(this.lineId(), 'comments'));
  }

  /** Open the delete confirmation over this sheet, pushed for the same reason. */
  async openDelete(): Promise<void> {
    if (this.saving()) {
      return;
    }
    await this._router.navigateByUrl(
      this._lineUrl(this.lineId(), 'confirm', 'delete')
    );
  }

  private _lineUrl(lineId: string, ...leaf: string[]): string {
    return appPath(
      this._localeStore.locale(),
      this._basePath,
      'zones',
      this.zoneId(),
      'lists',
      this.listId(),
      ...sheetSegments('lines', lineId, ...leaf)
    );
  }

  /** Back from the how many step to the summary, without leaving the sheet. */
  cancelStep(): void {
    this.step.set('summary');
    this._clearError();
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
    if (this.saving()) {
      return;
    }
    await this._sheet.leaveTo(
      appPath(
        this._localeStore.locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId(),
        'lines',
        this.lineId()
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

/**
 * The question a `line_merge_required` refusal asks, or null for any other failure.
 *
 * Mapped from `unknown` (rule D4): a refusal whose details this build cannot read is
 * not a question the sheet can ask, and falls through to the generic sentence.
 */
export function mergeQuestionOf(
  error: unknown,
  amount: number
): MergeQuestion | null {
  if (
    !(error instanceof GatewayError) ||
    error.code !== 'line_merge_required'
  ) {
    return null;
  }

  const other = error.details?.['otherContent'];
  const otherQuantity = error.details?.['otherQuantity'];
  if (
    typeof other !== 'string' ||
    typeof otherQuantity !== 'number' ||
    !Number.isFinite(otherQuantity)
  ) {
    return null;
  }

  return {
    other,
    otherQuantity,
    total: Math.min(LINE_QUANTITY_MAX, amount + otherQuantity),
  };
}

/** The bound a `line_merge_too_many_products` refusal names, or null. */
function maxOf(error: unknown): number | null {
  if (
    !(error instanceof GatewayError) ||
    error.code !== 'line_merge_too_many_products'
  ) {
    return null;
  }
  const max = error.details?.['max'];
  return typeof max === 'number' && Number.isFinite(max) ? max : null;
}
