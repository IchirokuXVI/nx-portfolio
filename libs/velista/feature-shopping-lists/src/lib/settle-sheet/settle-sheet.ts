import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore } from '@portfolio/velista/data-access';
import {
  inLocale,
  outstanding,
  type BasketLine,
  type BasketSettleResult,
} from '@portfolio/velista/models';
import { SheetShell } from '@portfolio/velista/ui';

/**
 * Which pane of the sheet is showing.
 *
 * One sheet with three panes rather than three sheets, because they are one
 * gesture at progressively more precision (section 4.2) and because a person in
 * an aisle should reach any of them in one tap from the row: three routes would
 * make the precise ones two taps and a navigation away from the number they were
 * about to type.
 */
type Pane = 'settle' | 'quantity' | 'product' | 'allocate';

/**
 * Settling one line: the whole amount, a number, or per household (plan 0044,
 * section 4.2).
 *
 * ## The two buttons, and why the first is one tap
 *
 * **Settle closes the whole outstanding amount** and is the common case, so it is
 * the largest control and takes one tap. **Partial submit asks for a number** and
 * is available to everybody, guests included, because it asks nothing about
 * zones. **Allocate** is the same act done precisely and is drawn only for a
 * reader who passes the all or nothing rule, because naming source lists is
 * naming zone data.
 *
 * A guest is never asked which household a tin of tomatoes belongs to. They are
 * in a shop with a list. The system allocates oldest origin first and the
 * allocation pane exists for the people who can see enough to correct it.
 *
 * ## Not available is here, and it is not a quantity
 *
 * It closes the outstanding amount without claiming anything was bought, which is
 * why it sits beside the two settle buttons and ignores whatever number is in the
 * stepper.
 *
 * ## What a settle can leave behind
 *
 * An origin whose access has moved since the basket was made is skipped and
 * **reported** rather than failing the whole act (backend `0051`, section 6.4). A
 * reader who passes the rule is told which lists; everybody else is told only how
 * many, because the names are zone data. Both are drawn: a shopper who has
 * already bought the thing has to know something did not land.
 */
@Component({
  selector: 'lib-settle-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './settle-sheet.html',
  styleUrl: './settle-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettleSheet {
  private readonly _store = inject(BasketStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _lineId = this._route.snapshot.paramMap.get('lineId') ?? '';
  private readonly _pane = signal<Pane>('settle');
  private readonly _busy = signal(false);
  private readonly _failed = signal(false);
  private readonly _result = signal<BasketSettleResult | null>(null);

  protected readonly pane = this._pane.asReadonly();
  protected readonly busy = this._busy.asReadonly();
  protected readonly failed = this._failed.asReadonly();
  protected readonly result = this._result.asReadonly();
  protected readonly seesZoneData = this._store.seesZoneData;

  /** The line this sheet is about, read live so a settle updates it under us. */
  protected readonly line = computed<BasketLine | null>(
    () => this._store.lines().find((row) => row.id === this._lineId) ?? null
  );

  protected readonly outstanding = computed(() => {
    const line = this.line();
    return line === null ? 0 : outstanding(line);
  });

  /**
   * What the stepper holds, for the partial submit.
   *
   * Starts at one rather than at the outstanding amount: somebody who wanted the
   * whole amount pressed the other button, so the number they are about to type
   * is by definition a smaller one.
   */
  protected readonly typed = signal(1);

  /** The picked product's name, for the line under the title. */
  protected readonly productName = computed<string | null>(() => {
    const pickId = this.line()?.pickId ?? null;
    const product =
      pickId === null ? undefined : this._store.basket()?.products.get(pickId);
    return product ? inLocale(product.name, this._locale()) : null;
  });

  /** Every product this line may be switched to, named, in the order given. */
  protected readonly options = computed(() => {
    const line = this.line();
    const products = this._store.basket()?.products;
    if (line === null || products === undefined) {
      return [];
    }
    return line.optionIds.flatMap((id) => {
      const product = products.get(id);
      // A product catalog no longer has is dropped rather than drawn as an id:
      // a basket outlives the catalog it was composed from.
      return product
        ? [
            {
              id,
              name: inLocale(product.name, this._locale()),
              brand: product.brand,
              chosen: id === line.pickId,
            },
          ]
        : [];
    });
  });

  /**
   * The allocation sheet's rows: one per source list, with what it wanted.
   *
   * Empty for a reader who does not pass the rule, which is also the reader for
   * whom the Allocate control is not drawn at all, so this is belt and braces
   * rather than the only guard.
   */
  protected readonly allocationRows = computed(() => {
    const origins = this.line()?.origins ?? [];
    return origins.map((origin) => ({
      listId: origin.listId,
      wanted: origin.quantity,
    }));
  });

  /** What the person has put against each list, keyed by list id. */
  protected readonly allocation = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly allocated = computed(() =>
    [...this.allocation().values()].reduce((sum, n) => sum + n, 0)
  );

  /** The sheet's accessible title, which is the line's own words. */
  protected readonly title = computed(() => this.line()?.content ?? '');

  /**
   * The whole outstanding amount, in one tap. The common case.
   */
  protected async settleAll(): Promise<void> {
    await this._send({ outcome: 'BOUGHT' });
  }

  /** A number the person typed. Asks nothing about zones, so guests may use it. */
  protected async settleSome(): Promise<void> {
    await this._send({ outcome: 'BOUGHT', quantity: this.typed() });
  }

  /**
   * The shop did not have it.
   *
   * An outcome rather than a quantity: it closes the outstanding amount, and it
   * claims nothing was bought.
   */
  protected async settleNone(): Promise<void> {
    await this._send({ outcome: 'NOT_AVAILABLE' });
  }

  /** The same act with the allocation supplied instead of derived. */
  protected async settleAllocated(): Promise<void> {
    const allocations = [...this.allocation().entries()]
      .filter(([, quantity]) => quantity > 0)
      .map(([listId, quantity]) => ({ listId, quantity }));

    await this._send({
      outcome: 'BOUGHT',
      quantity: this.allocated(),
      allocations,
    });
  }

  /** Swap the pick. Anybody may, guests included: options are catalog data. */
  protected async choose(itemId: string): Promise<void> {
    this._busy.set(true);
    const changed = await this._store.setPick(this._lineId, itemId);
    this._busy.set(false);
    if (changed !== null) {
      this._pane.set('settle');
    }
  }

  protected openPane(pane: Pane): void {
    this._failed.set(false);
    if (pane === 'allocate') {
      // Seeded from the default the server would have applied, so the sheet
      // opens on "what one tap would have done" and the person corrects it
      // rather than filling it in from nothing (section 4.2).
      this.allocation.set(this._defaultAllocation());
    }
    this._pane.set(pane);
  }

  protected setAllocation(listId: string, quantity: number): void {
    this.allocation.update((held) => {
      const next = new Map(held);
      next.set(listId, Math.max(0, quantity));
      return next;
    });
  }

  protected step(by: number): void {
    const max = this.outstanding();
    this.typed.update((n) => Math.min(Math.max(1, n + by), Math.max(1, max)));
  }

  protected close(): void {
    void this._router.navigate(['..'], { relativeTo: this._route });
  }

  /**
   * How many origins this act could not reach, phrased for whoever is reading.
   *
   * A reader who passes the rule gets the list names; everybody else gets the
   * count alone, which is section 6.4's report with the zone data taken out.
   */
  protected readonly missed = computed<string | null>(() => {
    const result = this._result();
    if (result === null || result.skippedCount === 0) {
      return null;
    }

    // The count, for every reader. Naming the lists would need the zone list
    // store, which this screen deliberately does not reach into: a basket screen
    // that could name a household would be a basket screen a guest could be
    // shown one from by a template mistake. `skipped` carries the ids for a
    // privileged reader and is left unused here for exactly that reason.
    return this._translator.t('basket.settle.missed', undefined, this._locale(), { count: result.skippedCount });
  });

  private _defaultAllocation(): ReadonlyMap<string, number> {
    // Oldest origin first until the outstanding amount is exhausted, which is
    // exactly what the server does when no allocation is supplied (backend
    // 0051, section 6.2). Reproducing it here is what makes the sheet a
    // correction rather than a blank form.
    let left = this.outstanding();
    const seeded = new Map<string, number>();
    for (const row of this.allocationRows()) {
      const take = Math.min(left, row.wanted);
      seeded.set(row.listId, take);
      left -= take;
    }
    return seeded;
  }

  private async _send(body: Parameters<BasketStore['settle']>[1]): Promise<void> {
    this._busy.set(true);
    this._failed.set(false);
    const result = await this._store.settle(this._lineId, body);
    this._busy.set(false);

    if (result === null) {
      this._failed.set(true);
      return;
    }

    this._result.set(result);
    if (result.skippedCount === 0) {
      // Nothing to report, so the sheet gets out of the way: the person is in a
      // shop and the next line is what they want to see.
      this.close();
    }
    // Otherwise it stays open showing what was missed, because a shopper who has
    // already bought the thing has to be told something did not land.
  }
}
