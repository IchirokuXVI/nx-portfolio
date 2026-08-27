import { Injectable } from '@angular/core';
import { delay, Observable, of } from 'rxjs';
import { ContactMessage } from './contact-message';
import { ContactServiceI } from './contact-service';

/**
 * Mocked contact sender: no request leaves the browser. It echoes the
 * submitted message back after a short delay so the UI can show a realistic
 * "sending…" → "sent" transition. Swap for an `ApiConsumer`-based implementation
 * of {@link ./contact-service}'s `ContactServiceI` (mirroring
 * `odontogram/data-access`'s `OdontogramApi`) once the endpoint exists — no
 * consumer changes required.
 */
@Injectable()
export class ContactMock implements ContactServiceI {
  send(message: ContactMessage): Observable<ContactMessage> {
    return of(message).pipe(delay(600));
  }
}
