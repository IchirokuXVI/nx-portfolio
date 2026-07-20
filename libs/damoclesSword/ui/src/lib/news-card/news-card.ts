import { AsyncPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { TranslatedNews } from '@portfolio/damoclesSword/data-access';
import { CalendarIcon, HomeIcon } from '@portfolio/shared/ui';

@Component({
  selector: 'lib-damoclesSword-news-card',
  imports: [AsyncPipe, CalendarIcon, HomeIcon],
  templateUrl: './news-card.html',
  styleUrl: './news-card.scss',
})
export class NewsCard {
  news = input.required<TranslatedNews>();

  /**
   * Normalises the optional image (a URL string or a resolving `import()`) into
   * a promise so a single async pipe can render either. `null` when absent, so
   * the template shows the placeholder until real images are wired in.
   */
  readonly imageSrc = computed(() => {
    const image = this.news().image;
    return image ? Promise.resolve(image) : null;
  });
}
