import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import { Observable } from 'rxjs';
import { ContactMessage } from './contact-message';
import { ContactMock } from './contact-mock';

/**
 * Contract for sending a contact / publishing message.
 */
export interface ContactServiceI {
  send(message: ContactMessage): Observable<ContactMessage>;
}

/**
 * DI token for the contact service, defaulting to the `ContactMock` placeholder
 * until a real endpoint exists. Inject this instead of a concrete class; swap
 * the default here once the backing implementation lands.
 */
export const CONTACT_SERVICE = serviceToken<ContactServiceI>(
  'CONTACT_SERVICE',
  () => inject(ContactMock)
);
