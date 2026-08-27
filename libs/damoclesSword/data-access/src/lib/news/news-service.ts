import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import { Observable } from 'rxjs';
import { TranslatedNews } from './news';
import { NewsMemory } from './news-memory';

export interface NewsServiceI {
  getList(locale: string): Observable<TranslatedNews[]>;
}

/**
 * DI token for the news service, defaulting to the in-memory implementation.
 * Inject this instead of a concrete class.
 */
export const NEWS_SERVICE = serviceToken<NewsServiceI>('NEWS_SERVICE', () =>
  inject(NewsMemory)
);
