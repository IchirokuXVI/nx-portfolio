import { Injectable } from '@angular/core';
import { TranslatedInfoFact } from '@portfolio/landing-v2/models';
import { of } from 'rxjs';
import { InfoFactServiceI } from './info-facts-service';
import { INFO_FACTS } from './static-info-facts-data';
import { INFO_FACTS_TRANSLATIONS } from './static-info-facts-translation-data';

/**
 * In-memory source for the hero's "facts" table. Joins each structural row
 * with its localized copy (falling back to `en`) and returns them ordered —
 * the UI (0003) renders this array directly, no hardcoded rows in the
 * template.
 */
@Injectable({
  providedIn: 'root',
})
export class InfoFactMemory implements InfoFactServiceI {
  private _facts = INFO_FACTS;
  private _factsTranslations = INFO_FACTS_TRANSLATIONS;

  private getTranslation(factId: string, locale: string) {
    return (
      this._factsTranslations.find(
        (t) => t.factId === factId && t.locale === locale
      ) ??
      this._factsTranslations.find(
        (t) => t.factId === factId && t.locale === 'en'
      )
    );
  }

  getList(locale: string) {
    const translatedFacts = this._facts
      .map((fact) => {
        const translation = this.getTranslation(fact.id, locale);

        if (!translation) {
          throw new Error(
            `Inconsistent data: no translation found for info fact ${fact.id}`
          );
        }

        return { ...fact, ...translation, id: fact.id } as TranslatedInfoFact;
      })
      .sort((a, b) => a.order - b.order);

    return of<TranslatedInfoFact[]>(translatedFacts);
  }
}
