import { inject, Injectable, signal } from '@angular/core';
import type { Contact } from '@portfolio/velista/models';
import { CONTACT_SERVICE, type ContactServiceI } from './contact-service';

/**
 * A hard stop on the cursor loop, matching the get list sheet's own.
 *
 * Reaching it means a server handing back the cursor it was given rather than a very
 * large household. A picker short by a page is a better failure than a phone asking
 * forever.
 */
const MAX_CONTACT_PAGES = 100;

/** How the contacts read has got on. */
export type ContactsLoad = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * Everybody the reader shares a group with, for the people picker (velista `0085`).
 *
 * App scoped, because two sheets read it: the get list sheet and the share sheet. It
 * follows the cursor to the end, since a picker that silently stops at the first page
 * hides somebody who is simply further down the answer.
 *
 * **Read again every time a sheet opens.** Nothing on the socket says that somebody
 * joined a group, so a list held for the whole app run would miss the flatmate who
 * joined this morning. What is held stays on screen while the new read is out, so
 * the second opening draws at once.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9.
@Injectable()
export class ContactStore {
  private readonly _service = inject<ContactServiceI>(CONTACT_SERVICE);

  private readonly _contacts = signal<readonly Contact[]>([]);
  private readonly _state = signal<ContactsLoad>('idle');

  /** Every membership, flat, in the order the server answered. */
  readonly contacts = this._contacts.asReadonly();

  readonly state = this._state.asReadonly();

  /** The read out now, so two sheets opening together share one. */
  private _reading: Promise<void> | null = null;

  load(): Promise<void> {
    this._reading ??= this._read().finally(() => {
      this._reading = null;
    });
    return this._reading;
  }

  private async _read(): Promise<void> {
    if (this._state() !== 'loaded') {
      this._state.set('loading');
    }

    try {
      const contacts: Contact[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < MAX_CONTACT_PAGES; page++) {
        const answered = await this._service.listContacts(cursor);
        contacts.push(...answered.items);
        if (answered.nextCursor === null) {
          break;
        }
        cursor = answered.nextCursor;
      }

      this._contacts.set(contacts);
      this._state.set('loaded');
    } catch {
      // What was held stays. Only a first read that failed is a failure to show.
      if (this._state() !== 'loaded') {
        this._state.set('failed');
      }
    }
  }
}
