import { AsyncPipe } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'lib-damoclesSword-trailer-video',
  imports: [AsyncPipe],
  templateUrl: './trailer-video.html',
  styleUrl: './trailer-video.scss',
})
export class TrailerVideo {
  // @ts-ignore
  starlitLogo = import('../../../assets/starlit-logo.png').then(
    (m) => m.default
  );

  trailerLinks = input([
    {
      label: 'Patreon',
      url: 'https://www.patreon.com/profile/creators?u=162538734',
      // @ts-ignore
      icon: import('../../../assets/patreon-icon.svg').then((m) => m.default),
    },
    {
      label: 'Meta',
      url: 'https://www.meta.com',
      // @ts-ignore
      icon: import('../../../assets/meta-icon.svg').then((m) => m.default),
    },
    {
      label: 'Steam',
      url: 'https://store.steampowered.com',
      // @ts-ignore
      icon: import('../../../assets/steam-icon.svg').then((m) => m.default),
    },
  ]);
}
