import { inject } from '@angular/core';
import { TranslatedInfoFact } from '@portfolio/landing-v2/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { Observable } from 'rxjs';
import { InfoFactMemory } from './info-facts-memory';

export interface InfoFactServiceI {
  getList(locale: string): Observable<TranslatedInfoFact[]>;
}

/**
 * DI token for the landing-v2 info-fact service, defaulting to the in-memory
 * implementation. Inject this instead of a concrete class.
 */
export const INFO_FACT_SERVICE = serviceToken<InfoFactServiceI>(
  'INFO_FACT_SERVICE',
  () => inject(InfoFactMemory)
);
