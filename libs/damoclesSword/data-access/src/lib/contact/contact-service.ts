import { Observable } from 'rxjs';
import { ContactMessage } from './contact-message';

/**
 * Contract for sending a contact / publishing message. Implemented today by the
 * in-memory {@link ./contact-mock}; swap for an HTTP-backed implementation once
 * the server endpoint exists, without touching any consumer.
 */
export interface ContactServiceI {
  send(message: ContactMessage): Observable<ContactMessage>;
}
