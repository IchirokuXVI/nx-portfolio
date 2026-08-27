import { inject, Pipe, PipeTransform } from '@angular/core';
import { RokuTranslatorService } from './rokutranslator-service';

/**
 * Impure on purpose: `pure: false` lets an already rendered binding re-translate
 * when the locale changes at runtime (a pure pipe would only re-run on a key
 * change). Reading the active-locale and load-state signals inside `transform`
 * registers reactive dependencies, so OnPush views hosting a `| rokuT` binding are
 * marked dirty on a switch, and when the strings arrive, rather than waiting for an
 * unrelated change-detection pass.
 *
 * Trade-off: the pipe runs every change-detection cycle for every usage. That is
 * acceptable at this app's binding counts; if a hot template shows up in
 * profiling, move that template to the signal path (`store.locale()` in a
 * `computed`) without changing this pipe's API elsewhere.
 */
@Pipe({
  name: 'rokuT',
  pure: false,
})
export class RokuTranslatorPipe implements PipeTransform {
  private _serv = inject(RokuTranslatorService);

  /**
   * The second argument is either a namespace or a bag of interpolation values.
   *
   * Overloading it keeps every existing `| rokuT: 'someNs'` call site working while
   * letting a template write `| rokuT: { count: 3 }`, which is what a key with
   * `{{placeholders}}` or a plural needs. Passing values with an explicit namespace
   * uses the four argument form.
   *
   * A string is a namespace and an object is values: there is no ambiguity, because a
   * namespace is never an object and values are never a bare string.
   */
  transform(
    key: string,
    nsOrValues?: string | Record<string, unknown>,
    locale?: string,
    values?: Record<string, unknown>
  ): string {
    // Establish the reactive dependencies (see class comment). Harmless when a
    // `locale` override is passed.
    //
    // Two of them, because there are two moments a rendered binding has something
    // new to say: the locale changed, and the strings for the current locale
    // finished loading. The second is why an OnPush view no longer keeps the raw
    // keys it painted before the first `import()` resolved.

    const ns = typeof nsOrValues === 'string' ? nsOrValues : undefined;
    const interpolation =
      typeof nsOrValues === 'object' && nsOrValues !== null
        ? nsOrValues
        : values;

    return this._serv.t(key, ns, locale, interpolation);
  }
}
