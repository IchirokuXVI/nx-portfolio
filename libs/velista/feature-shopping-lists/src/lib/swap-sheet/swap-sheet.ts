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
  BasketStore,
  BasketViewStore,
  GroupMembers,
  LINE_SERVICE,
  type LineServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  basketRowProduct,
  catalogName,
  type BasketProduct,
  type BasketRow as BasketRowModel,
} from '@portfolio/velista/models';
import { rowKeyOf, SheetNavigation } from '@portfolio/velista/platform';
import { SheetShell, SimilarProducts } from '@portfolio/velista/ui';
import { basketPath } from '../basket-paths';
import { basketGroupScope, swappedItemIds } from './swap';

/**
 * Change a basket row's product for a similar one: another member of its group.
 *
 * Addressed at `<basket>/sheet/rows/:rowKey/swap`, beside the settle sheet. A
 * group is one product sold under several labels, so the rows here are the same
 * product from other brands or chains, priced at the basket's own scopes and
 * cheapest first by the price per litre or kilo.
 *
 * ## What a change writes
 *
 * A basket stores no lines, so the change is made where the product lives: on
 * each list line the row stands for, `PATCH /v1/lines/:id` with the product
 * replaced in place. A row is one product since backend `0201`, but its lines
 * can hold other products beside it, so each line gets its own set with that one
 * product replaced (velista `0139` keeps this sheet until `0140` replaces it with
 * Change). The page offers this only
 * when the reader may write every one of those lists, so a change never splits
 * a row in two. The basket is then read again, and the sheet closes.
 */
@Component({
  selector: 'lib-swap-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SimilarProducts],
  templateUrl: './swap-sheet.html',
  styleUrl: './swap-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwapSheet {
  private readonly _store = inject(BasketStore);
  private readonly _view = inject(BasketViewStore);
  private readonly _groupMembers = inject(GroupMembers);
  private readonly _lines = inject<LineServiceI>(LINE_SERVICE);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _rowKey = rowKeyOf(this._route);

  protected readonly busy = signal(false);
  protected readonly failed = signal(false);

  protected readonly row = computed<BasketRowModel | null>(() =>
    this._store.rowFor(this._rowKey())
  );

  /** The product the row draws, which is the one being changed. */
  protected readonly product = computed<BasketProduct | null>(() => {
    const row = this.row();
    if (row === null) {
      return null;
    }
    return basketRowProduct(row, this._store.products());
  });

  /** Every product the row's lines hold, which the similar products leave out. */
  protected readonly heldIds = computed<readonly string[]>(() => [
    ...new Set((this.row()?.entries ?? []).flatMap((entry) => entry.itemIds)),
  ]);

  protected readonly name = computed(() => {
    const product = this.product();
    return product === null ? '' : catalogName(product.name, this._locale());
  });

  private readonly _scope = computed(() =>
    basketGroupScope(this._store.basket()?.scopes)
  );

  protected readonly group = computed(() => {
    const groupId = this.product()?.productGroupId ?? null;
    if (groupId === null) {
      return null;
    }
    const entry = this._groupMembers.entry(groupId, this._scope());
    const members = entry?.status === 'ready' ? entry.members : null;
    const held = this.heldIds();
    return {
      members,
      loading: entry === null || entry.status === 'loading',
      failed: entry?.status === 'failed',
      // Answered, and nothing in it the row does not already hold.
      none:
        members !== null && members.every((member) => held.includes(member.id)),
    };
  });

  private readonly _load = effect(() => {
    const groupId = this.product()?.productGroupId ?? null;
    const scope = this._scope();
    if (groupId !== null) {
      untracked(() => void this._groupMembers.ensure([groupId], scope));
    }
  });

  /** Take `itemId` instead, on every line the row stands for. */
  async choose(itemId: string): Promise<void> {
    const row = this.row();
    const product = this.product();
    if (row === null || product === null || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.failed.set(false);
    const results = await Promise.allSettled(
      row.entries.map((entry) =>
        this._lines.updateLine(entry.lineId, {
          itemIds: swappedItemIds(entry.itemIds, product.id, itemId),
        })
      )
    );
    await this._store.refresh();
    this.busy.set(false);

    if (results.some((result) => result.status === 'rejected')) {
      this.failed.set(true);
      return;
    }
    this.close();
  }

  protected close(): void {
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._store.address())
    );
  }
}
