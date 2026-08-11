import { Observable } from 'rxjs';
import { ContactMessage } from './contact-message';

/**
 * Contract for sending a contact / publishing message.
 */
export interface ContactServiceI {
  send(message: ContactMessage): Observable<ContactMessage>;
}
