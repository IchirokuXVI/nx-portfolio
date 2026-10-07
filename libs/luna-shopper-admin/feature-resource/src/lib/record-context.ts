import { InjectionToken, type Signal } from '@angular/core';
import type {
  AnyResourceDescriptor,
  RecordChild,
  RecordMode,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';

/**
 * The record a page is open on, for everything the page draws under its
 * header (admin plan 0054, section 2.1).
 *
 * A tab, a panel and a link all belong to one record. This is the one place
 * each of them learns which: no part reads the route for the ID, so a part is
 * the same part wherever the page that holds it is mounted.
 *
 * **A part is built again for another record.** The page keys what it draws
 * under the header on the ID, so a part may read {@link id} once, while it is
 * built, and be right for as long as it lives.
 */
export interface RecordContext<T extends ResourceRow = ResourceRow> {
  readonly descriptor: AnyResourceDescriptor;
  /** The ID from the address. */
  readonly id: string;
  /** The record, or `null` until it is read. */
  readonly row: Signal<T | null>;
  readonly mode: Signal<RecordMode>;
  /** Read the record again, after a part wrote something that changes it. */
  reload(): Promise<void>;
  /**
   * The count beside one child of the record, or `null` when nothing holds
   * one (section 2.4). The page works it out once, so a tab and a panel of
   * the same child never disagree.
   */
  countOf(child: RecordChild): number | null;
}

/**
 * Provided by `RecordPage`. Absent anywhere else, which is how a view drawn
 * with no page around it knows that it has no collections to draw.
 */
export const RECORD_CONTEXT = new InjectionToken<RecordContext>(
  'RECORD_CONTEXT'
);
