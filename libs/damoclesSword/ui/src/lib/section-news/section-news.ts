import { Component, inject, OnInit, signal } from '@angular/core';
import {
  NewsMemory,
  TranslatedNews,
} from '@portfolio/damoclesSword/data-access';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CallToActionButton } from '../call-to-action-button/call-to-action-button';
import { BorderAlignment } from '../enums/border-alignment';
import { NewsCard } from '../news-card/news-card';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-news',
  imports: [RokuTranslatorPipe, NewsCard, CallToActionButton, SectionLayout],
  templateUrl: './section-news.html',
  styleUrl: './section-news.scss',
})
export class SectionNews implements OnInit {
  private readonly _newsServ = inject(NewsMemory);

  readonly news = signal<TranslatedNews[]>([]);

  ngOnInit() {
    this._newsServ
      .getList(RokuTranslator.getLocale())
      .subscribe((news) => this.news.set(news));
  }

  get BorderAlignment() {
    return BorderAlignment;
  }
}
