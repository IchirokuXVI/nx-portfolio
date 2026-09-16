import { Injectable } from '@angular/core';
import type { Contact, Page } from '@portfolio/velista/models';
import type { ContactServiceI } from './contact-service';

/** Small on purpose, so the fake pages and the paging loop is exercised. */
const PAGE_SIZE = 2;

/**
 * The caller's contacts, in memory. Asked for by name, never a default.
 *
 * Seeded with a person who is in **two** groups under two different names, because
 * that is the case the picker exists to get right: one person, ticked once, drawn in
 * both sections.
 */
@Injectable()
export class ContactMemory implements ContactServiceI {
  contacts: Contact[] = [
    { userId: 'u-marta', zoneId: 'zone-home', username: 'Marta' },
    { userId: 'u-leo', zoneId: 'zone-home', username: 'Leo' },
    { userId: 'u-marta', zoneId: 'zone-flat', username: 'Marta G.' },
  ];

  async listContacts(cursor?: string): Promise<Page<Contact>> {
    const from = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    const start = Number.isNaN(from) ? 0 : from;
    const next = start + PAGE_SIZE;

    return {
      items: this.contacts.slice(start, next),
      nextCursor: next < this.contacts.length ? String(next) : null,
    };
  }
}
