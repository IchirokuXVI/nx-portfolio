import { inject, Injectable, signal } from '@angular/core';
import type { ShopSection } from '@portfolio/velista/models';
import {
  SHOP_SECTIONS_SERVICE,
  type ShopSectionsServiceI,
} from './shop-sections-service';

/**
 * The sections of every shop the basket has been bought at, read once per shop per
 * session (velista `0120`, target 1).
 *
 * ## It never blocks a screen
 *
 * `CategoryStore`'s rule. Nothing waits on {@link ensure}: until a shop's sections
 * land, {@link sectionsOf} answers null and the basket is grouped by category as it
 * always was; when they land the signal changes and the grouping recomposes by
 * aisle. A failed read is forgotten, so the next {@link ensure} tries again, and a
 * shop that answered is never asked twice, so after the first visit the aisles are
 * there in the same frame as the shop.
 *
 * Kept in the order the shop is walked, as the server sent them. Their names are
 * pairs, resolved where they are drawn with the reader's locale, which can change
 * under a page that is already open.
 *
 * ## Written by hand
 *
 * A plain `signal`, and no `@angular/core/rxjs-interop`: every screen of the app
 * shares this, which is the kind of service CLAUDE.md says must not use it.
 */
// Provided by the app layer, never root: rule D5, like `CategoryStore` beside it.
@Injectable()
export class ShopSectionsStore {
  private readonly _service = inject<ShopSectionsServiceI>(
    SHOP_SECTIONS_SERVICE
  );

  private readonly _held = signal<ReadonlyMap<string, readonly ShopSection[]>>(
    new Map()
  );

  /** The reads in flight by shop, so a second caller joins one rather than asking again. */
  private readonly _pending = new Map<string, Promise<void>>();

  /** A shop's sections in its order, or null until they have been read. */
  sectionsOf(locationId: string | null): readonly ShopSection[] | null {
    return locationId === null ? null : (this._held().get(locationId) ?? null);
  }

  /**
   * Read a shop's sections, once per session.
   *
   * Idempotent, so the view store calls it every time the shop changes. Held after
   * the first answer; a failed read is retried by the next call.
   */
  ensure(locationId: string): Promise<void> {
    if (this._held().has(locationId)) {
      return Promise.resolve();
    }
    const pending = this._pending.get(locationId);
    if (pending !== undefined) {
      return pending;
    }

    const read = this._read(locationId).finally(() => {
      this._pending.delete(locationId);
    });
    this._pending.set(locationId, read);
    return read;
  }

  /** Test seam: hold these sections for a shop without a request. */
  prime(locationId: string, sections: readonly ShopSection[]): void {
    this._held.update((held) => new Map(held).set(locationId, sections));
  }

  private async _read(locationId: string): Promise<void> {
    let answer;
    try {
      answer = await this._service.sections(locationId);
    } catch {
      // The contract says it never throws. A double that does is still not allowed
      // to stop a screen.
      answer = null;
    }
    if (answer !== null) {
      this.prime(locationId, answer.sections);
    }
  }
}
