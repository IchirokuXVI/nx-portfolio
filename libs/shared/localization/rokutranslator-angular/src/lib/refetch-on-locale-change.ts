import { inject } from '@angular/core';
import { MonoTypeOperatorFunction, Observable } from 'rxjs';
import { RokuTranslatorService } from './rokutranslator-service';

/**
 * Pipeable sugar over `RokuTranslatorService.withLocale`: re-runs an existing cold
 * query whenever the locale changes, cancelling the in-flight previous-locale
 * request. The caller passes nothing.
 *
 * ```ts
 * treatments$ = this.treatmentService
 *   .getList(this.filter)
 *   .pipe(refetchOnLocaleChange());
 * ```
 *
 * `inject()` runs in the factory body, which evaluates when the pipe is built in an
 * injection context (a field initializer / constructor). Used outside one, `inject()`
 * throws `NG0203` by design, so there is no separate guard to write. For the rare
 * call site that cannot be an injection context, pass the service explicitly:
 * `refetchOnLocaleChange(this.i18n)`.
 *
 * `source$` must be cold / re-subscribable (HttpClient and `of(...)` are); it is
 * re-subscribed on each locale change.
 */
export function refetchOnLocaleChange<T>(
  i18n: RokuTranslatorService = inject(RokuTranslatorService)
): MonoTypeOperatorFunction<T> {
  return (source$: Observable<T>): Observable<T> =>
    i18n.withLocale(() => source$);
}
