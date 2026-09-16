import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Contact, Page } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toContact, toPage } from '../mapping/mappers';
import type { ContactServiceI } from './contact-service';

/** The gateway's `MAX_PAGE_SIZE`, so a household of any size costs as few reads as it can. */
const CONTACT_PAGE_SIZE = 100;

/**
 * The caller's contacts, over HTTP. The default behind `CONTACT_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the `HttpClient`
 * the app configures.
 */
@Injectable()
export class ContactApi implements ContactServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async listContacts(cursor?: string): Promise<Page<Contact>> {
    let params = new HttpParams().set('limit', CONTACT_PAGE_SIZE);
    if (cursor !== undefined) {
      params = params.set('cursor', cursor);
    }

    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway('/v1/contacts'), {
        params,
        context: operation('contacts.list'),
      })
    );

    return toPage(body, toContact);
  }
}
