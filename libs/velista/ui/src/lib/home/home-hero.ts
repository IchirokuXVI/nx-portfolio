import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * The headline and one paragraph on the anonymous screen.
 *
 * No navigation and no actions: the entry actions sit in the bottom third, in thumb
 * reach, and this is the only part of the screen that is purely persuasion.
 *
 * The headline is one key rather than two lines assembled here, so a translator
 * controls where it breaks. English wants a break after "One list."; Spanish may not.
 */
@Component({
  selector: 'lib-home-hero',
  imports: [RokuTranslatorPipe],
  template: `
    <div class="hero">
      <h1 class="headline">
        <div>
          {{ 'home.hero.headline.top' | rokuT }}
        </div>
        <div>
          {{ 'home.hero.headline.bottom' | rokuT }}
        </div>
      </h1>
      <p class="body">{{ 'home.hero.body' | rokuT }}</p>
    </div>
  `,
  styleUrl: './home-hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeHero {}
