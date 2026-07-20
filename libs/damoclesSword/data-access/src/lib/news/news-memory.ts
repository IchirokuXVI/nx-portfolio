import { Injectable } from '@angular/core';
import { of } from 'rxjs';
import { News, NewsTranslation, TranslatedNews } from './news';
import { NEWS } from './static-news-data';
import { NEWS_TRANSLATIONS } from './static-news-translation-data';

/**
 * In-memory news source backed by static mock data. Joins each news item with
 * its localized text (falling back to `en`), the same way the real endpoint
 * will return already-localized copy. Swap for an HTTP-backed implementation of
 * {@link NewsServiceI} once the server exists.
 */
@Injectable({
  providedIn: 'root',
})
export class NewsMemory {
  private _news = NEWS;
  private _newsTranslations = NEWS_TRANSLATIONS;

  private getTranslation(newsId: string, locale: string) {
    return (
      this._newsTranslations.find(
        (t) => t.newsId === newsId && t.locale === locale
      ) ??
      this._newsTranslations.find(
        (t) => t.newsId === newsId && t.locale === 'en'
      )
    );
  }

  getList(locale: string) {
    const translatedNews = this._news.map((news) => {
      const translation = this.getTranslation(news.id, locale);

      if (!translation) {
        throw new Error(
          `Inconsistent data: no translation found for news ${news.id}`
        );
      }

      return { ...news, ...translation } as News & NewsTranslation;
    });

    return of<TranslatedNews[]>(translatedNews);
  }
}
