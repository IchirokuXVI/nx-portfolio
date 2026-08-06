import { Component, input } from '@angular/core';

/**
 * A small presentational card: a title, an optional projected media slot, a
 * description and an accent bar. Shared by the About page's "Our Values" cards
 * and the Services page's "Our Approach" cards. Both `title` and `description`
 * are already-translated strings (the parent owns translation). Project a
 * `[media]` element to fill the media placeholder; the accent colour is driven
 * by the `--info-card-accent` CSS custom property.
 */
@Component({
  selector: 'lib-damocles-sword-info-card',
  imports: [],
  templateUrl: './info-card.html',
  styleUrl: './info-card.scss',
})
export class InfoCard {
  title = input<string>('');
  description = input<string>('');
}
