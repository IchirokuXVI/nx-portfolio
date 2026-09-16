import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { Contact, Page } from '@portfolio/velista/models';
import { ContactApi } from './contact-api';

/**
 * The people the caller shares a group with (backend `0114`, section 2).
 *
 * One page of memberships at a time, flat and unordered for display. A person in two
 * groups is two rows. Grouping and sorting belong to the screen, which has the group
 * names and the reader's language.
 */
export interface ContactServiceI {
  /** `GET /v1/contacts`. */
  listContacts(cursor?: string): Promise<Page<Contact>>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, for the reason every other service token here
 * gives: a wrong default that quietly works is worse than one that fails loudly.
 */
export const CONTACT_SERVICE = serviceToken<ContactServiceI>(
  'CONTACT_SERVICE',
  () => inject(ContactApi)
);
