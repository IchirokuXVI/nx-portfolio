import { Component, inject, OnInit, signal } from '@angular/core';
import { NewsMemory, TranslatedNews } from '@portfolio/damoclesSword/data-access';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CallToActionButton } from '../call-to-action-button/call-to-action-button';
import {
  BorderAlignment,
  DoubleBorderedTitle,
} from '../double-bordered-title/double-bordered-title';
import { NewsCard } from '../news-card/news-card';

@Component({
  selector: 'lib-damocles-sword-section-news',
  imports: [
    DoubleBorderedTitle,
    RokuTranslatorPipe,
    NewsCard,
    CallToActionButton,
  ],
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
