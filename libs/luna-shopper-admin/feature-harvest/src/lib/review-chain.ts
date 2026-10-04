import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { REVIEW_CHAIN_PARAM } from '@portfolio/luna-shopper-admin/models';

/**
 * The chain the four queues of Review are narrowed to (admin plan 0044,
 * target 4).
 *
 * One filter for the four queues, kept in the `chain` query parameter. The
 * switch between the queues carries it, so a person who is working one chain
 * moves from its products to its shops without choosing the chain again.
 *
 * **The address is the state.** This reads the parameter from the URL and
 * writes it back there, so a reload keeps the chain and a link carries it. It
 * holds a signal only so that a queue can react to a change without
 * `rxjs-interop`, which this workspace forbids in anything several apps could
 * load a copy of.
 *
 * Root scoped. The Review page and each queue under it read the same value,
 * and the suggested brands are a queue that lives in another library.
 */
@Injectable({ providedIn: 'root' })
export class ReviewChain {
  private readonly _router = inject(Router);

  private readonly _chain = signal(this._read(this._router.url));

  /** The chain's id, or `''` when the queues are not narrowed. */
  readonly chain = this._chain.asReadonly();

  constructor() {
    const events = this._router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this._chain.set(this._read(event.urlAfterRedirects));
      }
    });

    inject(DestroyRef).onDestroy(() => events.unsubscribe());
  }

  /**
   * Narrow the queues to a chain, or to none with `''`.
   *
   * The signal moves at once, so the queue reloads without waiting for the
   * navigation. The URL follows, replacing the entry: a filter is not a place
   * the back button should return to.
   */
  choose(supermarketId: string): void {
    this._chain.set(supermarketId);

    const tree = this._router.parseUrl(this._router.url);
    const kept = { ...tree.queryParams };
    delete kept[REVIEW_CHAIN_PARAM];
    tree.queryParams =
      supermarketId === ''
        ? kept
        : { ...kept, [REVIEW_CHAIN_PARAM]: supermarketId };

    void this._router.navigateByUrl(tree, { replaceUrl: true });
  }

  /** The parameters a link to another queue carries, to keep the chain. */
  params(): Readonly<Record<string, string>> {
    const chain = this._chain();
    return chain === '' ? {} : { [REVIEW_CHAIN_PARAM]: chain };
  }

  private _read(url: string): string {
    const value = this._router.parseUrl(url).queryParams[REVIEW_CHAIN_PARAM];
    return typeof value === 'string' ? value : '';
  }
}
