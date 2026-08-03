import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { AssetMemory } from '@portfolio/damoclesSword/data-access';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

@Component({
  selector: 'lib-damocles-sword-trailer-video',
  imports: [AsyncPipe, RokuTranslatorPipe],
  templateUrl: './trailer-video.html',
  styleUrl: './trailer-video.scss',
})
export class TrailerVideo {
  private readonly _assets = inject(AssetMemory);

  // The logo lives with projects data, so request with the service
  starlitLogo = this._assets.get('starlit-logo');

  trailerLinks = input([
    {
      label: 'Patreon',
      url: 'https://www.patreon.com/profile/creators?u=162538734',
      icon: import('../../../assets/patreon-icon.svg').then((m) => m.default),
    },
    {
      label: 'Meta',
      url: 'https://www.meta.com',
      icon: import('../../../assets/meta-icon.svg').then((m) => m.default),
    },
    {
      label: 'Steam',
      url: 'https://store.steampowered.com',
      icon: import('../../../assets/steam-icon.svg').then((m) => m.default),
    },
  ]);
}
