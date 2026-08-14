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
  // TODO(di-wiring): injected as a concrete implementation instead of via a DI token bound to the service interface, so the real/API impl cannot be swapped without editing here. Tracked in libs/shared/data-access/plans/0001-data-access-di-token-wiring.md
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
