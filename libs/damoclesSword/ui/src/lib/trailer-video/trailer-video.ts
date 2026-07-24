import { AsyncPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

@Component({
  selector: 'lib-damoclesSword-trailer-video',
  imports: [AsyncPipe, RokuTranslatorPipe],
  templateUrl: './trailer-video.html',
  styleUrl: './trailer-video.scss',
})
export class TrailerVideo {
  starlitLogo = import('../../../assets/starlit-logo.avif').then(
    (m) => m.default
  );

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
