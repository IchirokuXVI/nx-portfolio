import { inject, Injectable } from '@angular/core';
import { of } from 'rxjs';
import { ASSET_SERVICE } from '../asset/asset-service';
import { News, NewsTranslation, TranslatedNews } from './news';
import { NewsServiceI } from './news-service';
import { NEWS } from './static-news-data';
import { NEWS_TRANSLATIONS } from './static-news-translation-data';

/**
 * In-memory news source backed by static mock data. Joins each news item with
 * its localized text (falling back to `en`), the same way the real endpoint
 * will return already-localized copy, and resolves each item's image asset key
 * to a URL. Swap for an HTTP-backed implementation of {@link ./news-service}'s
 * `NewsServiceI` once the server exists.
 */
@Injectable()
export class NewsMemory implements NewsServiceI {
  private readonly _assets = inject(ASSET_SERVICE);
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

      const resolved: News = {
        id: news.id,
        icon: news.icon,
        image: news.imageAsset ? this._assets.get(news.imageAsset) : undefined,
      };

      return { ...resolved, ...translation } as News & NewsTranslation;
    });

    return of<TranslatedNews[]>(translatedNews);
  }
}
