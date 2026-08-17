import { Injectable, signal } from '@angular/core';
import { Observable, of } from 'rxjs';

@Injectable()
export class RokuTranslatorTestingService {
  loaded$ = of(true);

  readonly locale = signal('en');
  readonly locale$ = of('en');

  getLocale() {
    return this.locale();
  }

  t(key: string, _ns?: string, _locale?: string) {
    return key;
  }

  withLocale<T>(project: () => Observable<T>): Observable<T> {
    return project();
  }
}
