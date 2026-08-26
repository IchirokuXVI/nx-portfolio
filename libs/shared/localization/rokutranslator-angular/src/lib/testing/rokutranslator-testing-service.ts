import { Injectable, signal } from '@angular/core';
import { Observable, of } from 'rxjs';

@Injectable()
export class RokuTranslatorTestingService {
  loaded$ = of(true);

  /**
   * Already `true`: a test has its strings the moment it renders, so nothing has to
   * wait or re-render. The pipe reads this, so the double has to carry it.
   */
  readonly loaded = signal(true);

  readonly locale = signal('en');
  readonly locale$ = of('en');

  getLocale() {
    return this.locale();
  }

  /**
   * Returns the key, so a test asserts on which string was asked for rather than on
   * copy that a translator is free to change.
   *
   * `values` is accepted and ignored, mirroring the real service's signature. A test
   * that needs to prove the right *values* reached a template should assert on the
   * view model that produced them, which is a cheaper and more precise check than
   * reading interpolated text out of the DOM.
   */
  t(
    key: string,
    _ns?: string,
    _locale?: string,
    _values?: Record<string, unknown>
  ) {
    return key;
  }

  withLocale<T>(project: (locale: string) => Observable<T>): Observable<T> {
    return project(this.locale());
  }
}
