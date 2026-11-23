import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  lineRowFacts,
  lineStatuses,
  priceWordsText,
  QUANTITY_REEL_CLICK_SHIELD_MS,
  type LineRowFacts,
  type LineRowShownProduct,
  type LineRowVm,
  type LineStatus,
  type ListRowLayout,
  type QuantityStep,
} from '@portfolio/velista/models';
import { formatAmount } from '@portfolio/velista/platform';
import {
  CommentIcon,
  PlusIcon,
  SpinnerIcon,
  StarFilledIcon,
} from '../icons/icons';
import { ProductPicture } from './product-picture';
import { QuantityReel } from './quantity-reel';
import { QuantityStepper } from './quantity-stepper';

/** The words of section 4, by status. */
const STATUS_KEYS: Record<LineStatus, string> = {
  awaiting: 'list.line.awaitingApproval',
  rejected: 'list.line.rejected',
  claimed: 'line.indicator.claimed',
  notAvailable: 'line.indicator.notAvailable',
  bought: 'line.indicator.bought',
};

/** The presses a row being cleared swallows (velista `0199`). */
const LOCKED_EVENTS = ['click', 'pointerdown', 'keydown'] as const;

/**
 * What the row emits: the three approval decisions drawn under it.
 *
 * Edit, comments and delete were here until velista plan 0083, carried by an overflow
 * menu. The detail sheet a tap opens is where a line is changed now, so the row has
 * nothing of its own to say about them.
 */
export type LineRowAction = 'approve' | 'reject' | 'restore';

/**
 * One line on the list. The row this whole screen is for.
 *
 * ## The row is a button, and the number beside it is the control
 *
 * It was a checkbox: `role="checkbox"`, `aria-checked`, and a tap that ticked it off.
 * Velista plan 0043 section 1.1 takes all of that back, and it is a rewrite rather than
 * an edit. There is no checked state left to report, because a tick is a fact about one
 * shopping trip written onto a record that outlives every trip. What a tap does now is
 * **open what the app knows about the thing**, which is a button's job, and what says
 * whether the household wants it is the quantity.
 *
 * So the row has two live parts and they follow two different permissions. The row
 * opens for anybody holding `READ`, because knowing is not deciding. The stepper moves for
 * `DECIDE`. A reader gets a row that opens and a number that does not move, which is
 * honest in both directions.
 *
 * ## Two targets, and no more
 *
 * The row and the stepper. A row with an edit button, a comment button and a delete
 * button on it is a row nobody can tap correctly while walking. The overflow menu that
 * held those three went in velista plan 0083: the detail sheet a tap opens edits the
 * line, and reaches its comments and its delete.
 *
 * The stepper (velista `0188`) is two buttons and an amount in one capsule of 155 by
 * 48, and it stops the pointer and the click from reaching the row underneath, so a
 * press on minus or plus never opens the sheet. It is the control of the default
 * view.
 *
 * ## In the compact view the control is the reel, and an open reel makes the line deaf
 *
 * The compact view draws the reel of velista `0043` in place of the stepper (velista
 * `0203`), 52 by 44. Its overlay runs sideways over the row it belongs to, so the tap
 * that dismisses it lands on the row underneath. That tap **closes the reel and does
 * nothing else**: it was aimed at the thing on top. The same holds for
 * {@link QUANTITY_REEL_CLICK_SHIELD_MS} after the overlay times out on its own, since
 * a finger already falling does not stop when what it was falling towards vanishes.
 *
 * It is decided at `pointerdown` and enforced at `click`, both in the capture phase.
 * The state has to be read at the press because focus leaves the reel between the
 * press and the click, which closes it, so by click time there is nothing left to
 * notice. The reel has no hold and no trash, so the lock of velista `0199` is the
 * stepper's alone; a row locked in the default view stays locked when the view
 * changes, because the lock is on the host and the layer over both layouts.
 *
 * ## A row with a write in flight stays live
 *
 * `aria-busy`, and still usable. Blocking it would make the app feel slow on exactly
 * the connection it was designed for, and the next adjustment simply supersedes the
 * last (`0012`, section 3.3).
 *
 * It is not dimmed (velista `0197`, the owner's ruling of 2026-11-22). It was drawn at
 * 70%, and on the night theme that let the dark page show through the stepper and the
 * photo, so the row darkened and lightened again a beat after every step. Most people
 * never learned what the dimming meant; the default row's spinner in place of the
 * total says it better. The class `in-flight` stays, with no rule, because specs read
 * it as the state.
 *
 * One write is the exception: the trash's (velista `0199`, the owner's ruling of
 * 2026-11-22). From its press until the write to 0 answers, the row is `clearing`:
 * locked, on the sunken surface of a pressed row, with a spinner in the middle. It
 * is the same in both layouts, because it is drawn over the row element they share.
 *
 * ## Somebody else editing is drawn, and decides nothing
 *
 * Their initial and a subdued word, from `PresenceStore.editorOfLine` by way of the
 * container. It is advisory (plan 0022, section 3): no lock, no warning, no disabled
 * control, and no change to what a tap does. The one thing it must not become is a
 * guard, because presence under reports and a guard built on it would refuse an edit
 * nobody is making.
 */
@Component({
  selector: 'lib-line-row',
  imports: [
    RokuTranslatorPipe,
    CommentIcon,
    PlusIcon,
    ProductPicture,
    QuantityReel,
    QuantityStepper,
    SpinnerIcon,
    StarFilledIcon,
  ],
  templateUrl: './line-row.html',
  styleUrl: './line-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineRow {
  readonly line = input.required<LineRowVm>();

  /**
   * How the row is drawn (velista `0202`): the default view, the row of velista
   * `0191` with the label and the brand on one line and three fact lines beside the
   * stepper, or the compact view, the two line row. One component either way, so
   * every row feature exists once and both layouts draw it.
   */
  readonly layout = input<ListRowLayout>('default');

  /** Whether this is the two line row of the compact view (velista `0202`). */
  protected readonly compact = computed(() => this.layout() === 'compact');

  /** Whether an add just raised this line, which marks its quantity (velista `0170`). */
  readonly took = input(false);

  /**
   * The amount of an open run of presses, or null to draw the stored one (velista
   * `0188`, decision H). The page owns the run and writes it after the quiet beat.
   */
  readonly pending = input<number | null>(null);

  /**
   * Whether the line is being cleared (velista `0199`): its trash was pressed, the
   * write to 0 went out at once, and the page keeps the row drawn until it answers.
   * The row is locked meanwhile: a darker background, a spinner in the middle, and no
   * press inside it reaches anything.
   */
  readonly clearing = input(false);

  /** What the row's stepper draws: the open run, or the stored amount. */
  protected readonly amount = computed(
    () => this.pending() ?? this.line().quantity
  );

  /**
   * Where a search matched inside the line's own name, or null (velista `0082`,
   * section 6).
   *
   * A range and not the query, so the row stays ignorant of how the search folds. Null
   * for no search and for a line that matched on a product or a category, where there
   * is nothing in the name to point at.
   */
  readonly match = input<{
    readonly start: number;
    readonly end: number;
  } | null>(null);

  /** The name split around the match, or null to draw it whole. */
  protected readonly highlighted = computed(() => {
    const range = this.match();
    const content = this.line().content;
    if (range === null || range.end > content.length) {
      return null;
    }
    return {
      before: content.slice(0, range.start),
      match: content.slice(range.start, range.end),
      after: content.slice(range.end),
    };
  });

  /** A tap on the row, which opens the detail sheet. */
  readonly opened = output<string>();

  /**
   * Every step of the row's stepper, a press or a repeat of a hold (velista `0188`).
   * The row saves nothing: the page gathers the steps into one write.
   */
  readonly quantityStepped = output<{ lineId: string; step: QuantityStep }>();

  /**
   * The reel of the compact view closed on a new amount (velista `0203`): one step
   * from the amount it opened on. Its own output, because the page writes it at once
   * rather than waiting a quiet beat, and because a reel at 0 is not the trash.
   */
  readonly quantityReeled = output<{ lineId: string; step: QuantityStep }>();

  /** Anything from the decision buttons. */
  readonly act = output<{ action: LineRowAction; lineId: string }>();

  /** The inline failure notice was tapped, which retries. */
  readonly retry = output<string>();

  /** The overwritten notice was dismissed. */
  readonly dismiss = output<string>();

  /**
   * The plus or "Choose a product" was pressed on a line with no product (velista
   * `0145`, section 5). The page opens the catalog to choose one.
   */
  readonly chooseProduct = output<string>();

  /** The product the row shows, or null while it draws none. */
  protected readonly shown = computed<LineRowShownProduct | null>(() => {
    const product = this.line().product;
    return product?.kind === 'shown' ? product : null;
  });

  /** Whether the reader may choose the product of this line (section 5). */
  protected readonly mayChoose = computed(() => {
    const product = this.line().product;
    return product?.kind === 'none' && product.canChoose;
  });

  /**
   * The default row's three facts, or null while it shows no product (velista
   * `0191`, section 2.2). Decided by `lineRowFacts` over what the builder set; the
   * total is of the stored quantity, which is the one the builder counted.
   */
  protected readonly facts = computed<LineRowFacts | null>(() => {
    const shown = this.shown();
    return shown === null ? null : lineRowFacts(shown);
  });

  /**
   * Whether the default row's third fact draws the saving mark in place of the total
   * (velista `0191`, the owner's decision of 2026-11-12): while the line has an open
   * run of presses, or its write is in flight. The total follows the stored amount,
   * so during a run it would still say what the old amount cost.
   *
   * One condition over both states, so the hand over cannot flash the old price:
   * `quantityRuns` clears `pending` and starts the write in the same task, and the
   * line store marks the write pending before its first await, so the two signals
   * change together and no frame draws neither. Every row with a product: line 3 is
   * a total for every kind, so it always changes with the amount.
   */
  protected readonly saving = computed(
    () =>
      this.shown() !== null &&
      (this.pending() !== null || this.line().write === 'pending')
  );

  /** The second fact, the unit price, as one string ("2,50 € / kg"), or empty. */
  protected readonly unitPriceText = computed(() => {
    const words = this.facts()?.unitPrice ?? null;
    return words === null ? '' : priceWordsText(words);
  });

  /** Every status word that applies, in the order of section 4. */
  protected readonly statuses = computed(() => lineStatuses(this.line()));

  /** The one word the row draws: the first that applies. */
  protected readonly status = computed(() => this.statuses()[0] ?? null);

  protected statusKey(status: LineStatus): string {
    return status === 'claimed' && this.line().claimedBy !== null
      ? 'line.indicator.claimedBy'
      : STATUS_KEYS[status];
  }

  protected readonly statusArgs = computed(() => ({
    name: this.line().claimedBy ?? '',
  }));

  protected onChoose(event: Event): void {
    event.stopPropagation();
    this.chooseProduct.emit(this.line().id);
  }

  private readonly _translator = inject(RokuTranslatorService);
  private readonly _reel = viewChild(QuantityReel);
  private readonly _reelEl = viewChild(QuantityReel, { read: ElementRef });

  /** Until when a tap on this line is swallowed, after the reel closed by itself. */
  private _deafUntil = 0;

  /** Whether the click this press will produce belongs to the reel rather than the row. */
  private _swallowClick = false;

  /**
   * The lock of a row being cleared (velista `0199`), on the host and in the capture
   * phase, so a press is stopped before it reaches the stepper, the picture, a choose
   * button or the row itself, and none of them has to know about the lock. Tab and
   * Escape pass, so focus can still leave the row, and so does a key with Alt, Ctrl
   * or Meta held, so the browser's shortcuts still work. A notice under the row is
   * not covered by the lock's layer, so nothing on it is stopped either.
   */
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const stop = (event: Event) => {
      if (!this.clearing()) {
        return;
      }
      if (event.target instanceof Element && event.target.closest('.notice')) {
        return;
      }
      if (
        event instanceof KeyboardEvent &&
        (event.key === 'Tab' ||
          event.key === 'Escape' ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    for (const type of LOCKED_EVENTS) {
      host.addEventListener(type, stop, true);
    }

    // The deaf rule of the reel (velista `0203`), after the lock, so a locked row
    // stops the press before the reel's rule reads it. Native listeners rather than
    // host bindings, because both have to run in the capture phase.
    const onPress = (event: Event) => this._notePress(event);
    const onClick = (event: Event) => this._swallowReelDismissal(event);
    host.addEventListener('pointerdown', onPress, true);
    host.addEventListener('click', onClick, true);

    inject(DestroyRef).onDestroy(() => {
      for (const type of LOCKED_EVENTS) {
        host.removeEventListener(type, stop, true);
      }
      host.removeEventListener('pointerdown', onPress, true);
      host.removeEventListener('click', onClick, true);
    });
  }

  /**
   * At the press, work out whether this tap is really about the reel: it is while the
   * reel is open, and for the click shield after it closed by itself. Read here and
   * not at the click because the press moves focus, the reel commits and closes on
   * losing it, and by the time the click arrives the overlay is gone.
   */
  private _notePress(event: Event): void {
    if (this._withinReel(event.target)) {
      this._swallowClick = false;
      return;
    }

    const reel = this._reel();
    const open = reel?.open() ?? false;
    this._swallowClick = open || Date.now() < this._deafUntil;

    // Closed here rather than left to the blur. A tap on a span that cannot take focus
    // moves focus nowhere, which is the ordinary case on a touch screen, and the reel
    // would sit there until its own timer ran out.
    if (open) {
      reel?.close();
    }
  }

  private _swallowReelDismissal(event: Event): void {
    if (!this._swallowClick || this._withinReel(event.target)) {
      return;
    }

    this._swallowClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  private _withinReel(target: EventTarget | null): boolean {
    const reel = this._reelEl()?.nativeElement as HTMLElement | undefined;
    return (
      target !== null && reel !== undefined && reel.contains(target as Node)
    );
  }

  /**
   * The reel timed out and closed on its own, which starts the deaf beat. Only this
   * path: a reel closed by a tap elsewhere on the line has already cost that tap.
   */
  protected onReelAutoClosed(): void {
    this._deafUntil = Date.now() + QUANTITY_REEL_CLICK_SHIELD_MS;
  }

  /** The reel's one step, as the page's own output. */
  protected onReeled(step: QuantityStep): void {
    this.quantityReeled.emit({ lineId: this.line().id, step });
  }

  /**
   * The accessible name (velista `0145`, section 3): the name, the product with its
   * brand and its size when the line is named, the price, and how many.
   *
   * Assembled here rather than in the template so the quantity is present in the name
   * exactly when it is present on screen, and so the two cannot drift. **The number
   * is always in it**: the quantity is the line's state, and a name that said "Olive
   * oil" for a line at zero and "Olive oil, 2" a moment later would hide the only
   * thing that changed.
   *
   * A row built without a catalog keeps the old name: the format and the brand, when
   * it draws them, tell two lines of one name apart.
   *
   * The star and the "+N" are in it too. The row is a button with a name of its own,
   * so the names those two marks carry are never read out.
   */
  accessibleName(): string {
    const line = this.line();
    const shown = this.shown();
    // The dependencies the pipe takes, so the name follows the locale and the strings.
    this._translator.locale();
    this._translator.loaded();
    const parts: (string | null | undefined)[] = [line.content];
    if (!this.compact() && shown !== null) {
      parts.push(...this._factsNameParts(shown));
    } else if (line.product === undefined) {
      parts.push(line.detail);
    } else if (shown !== null) {
      if (shown.favorite) {
        parts.push(this._translator.t('list.row.favorite'));
      }
      if (line.named === true) {
        parts.push(shown.name, shown.brandSize);
      }
      parts.push(shown.price === null ? null : priceWordsText(shown.price));
      if (shown.others > 0) {
        parts.push(
          this._translator.t('list.row.more', undefined, undefined, {
            count: shown.others,
          })
        );
      }
    }
    // The quantity in its words: "3" for a count, "750 g" for a weight (velista `0182`).
    parts.push(
      formatAmount(this.amount(), line.unit, this._translator.locale())
    );
    return parts
      .filter((part): part is string => part != null && part !== '')
      .join(', ');
  }

  /**
   * The product's part of a default row's name (velista `0191`, section 5): what the
   * row draws, in its order. The favourite, the brand, the size, the unit price, the
   * total ("about 1,88 €" for an estimate), and "+N". A named line's product name is
   * not drawn, so it is not read (decision E). While the saving mark stands in for
   * the total, the total is left out: it would state the old cost.
   */
  private _factsNameParts(shown: LineRowShownProduct): (string | null)[] {
    const facts = lineRowFacts(shown);
    const total = this.saving() ? null : facts.total;
    return [
      shown.favorite ? this._translator.t('list.row.favorite') : null,
      shown.brand,
      facts.size,
      facts.unitPrice === null ? null : priceWordsText(facts.unitPrice),
      total === null
        ? null
        : total.estimated
          ? this._translator.t('list.row.about', undefined, undefined, {
              price: total.amount,
            })
          : total.amount,
      shown.others > 0
        ? this._translator.t('list.row.more', undefined, undefined, {
            count: shown.others,
          })
        : null,
    ];
  }

  /**
   * What `aria-describedby` points at: every status word that applies.
   *
   * They are descriptions rather than part of the name: a name that grew "bought" and
   * "Ana is buying this" would read both out every time focus touched the row, ahead
   * of the thing itself.
   */
  describedBy(): string | null {
    const ids = [
      this.statuses().length === 0 ? null : `st-${this.line().id}`,
      // The lock's word, "Saving" (velista `0199`).
      this.clearing() ? `lk-${this.line().id}` : null,
    ].filter((id): id is string => id !== null);
    return ids.length === 0 ? null : ids.join(' ');
  }

  onRowClick(): void {
    if (!this.line().interactive || this.clearing()) {
      return;
    }

    this.opened.emit(this.line().id);
  }

  /**
   * Space and Enter, because a `div` with `role="button"` gets neither for free.
   *
   * Both, which the button role calls for and which everybody expects anyway. Only
   * on the row itself: a key on a button inside it is that button's.
   */
  onRowKeydown(event: KeyboardEvent): void {
    if (event.key !== ' ' && event.key !== 'Enter') {
      return;
    }
    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    this.onRowClick();
  }

  /** One of the decisions drawn under the row. */
  choose(action: 'approve' | 'reject' | 'restore'): void {
    this.act.emit({ action, lineId: this.line().id });
  }

  /**
   * The editor's initial, or an empty string when nobody is editing.
   *
   * Code points rather than a slice, for the reason every other initial in this app is:
   * slicing a string cuts a surrogate pair in half, and a name that starts with an emoji
   * would render the replacement character.
   */
  readonly editorInitial = computed(() => {
    const name = this.line().editor?.trim() ?? '';
    return name === '' ? '' : (Array.from(name)[0] ?? '').toLocaleUpperCase();
  });
}
