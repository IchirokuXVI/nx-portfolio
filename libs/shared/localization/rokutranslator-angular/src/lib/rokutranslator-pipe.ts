import { inject, Pipe, PipeTransform } from '@angular/core';
import { RokuTranslatorService } from './rokutranslator-service';

/**
 * Impure on purpose: `pure: false` lets an already rendered binding re-translate
 * when the locale changes at runtime (a pure pipe would only re-run on a key
 * change). Reading the active-locale signal inside `transform` registers a
 * reactive dependency, so OnPush views hosting a `| rokuT` binding are marked
 * dirty on a switch rather than waiting for an unrelated change-detection pass.
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
    // Establish the reactive dependency (see class comment). Harmless when a
    // `locale` override is passed.
    this._serv.locale();

    const ns = typeof nsOrValues === 'string' ? nsOrValues : undefined;
    const interpolation =
      typeof nsOrValues === 'object' && nsOrValues !== null
        ? nsOrValues
        : values;

    return this._serv.t(key, ns, locale, interpolation);
  }
}
