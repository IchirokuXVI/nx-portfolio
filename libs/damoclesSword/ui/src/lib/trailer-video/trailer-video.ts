import { AsyncPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { AssetMemory } from '@portfolio/damoclesSword/data-access';
import {
  MuteIcon,
  PauseIcon,
  PlayIcon,
  VolumeIcon,
} from '@portfolio/shared/ui';

@Component({
  selector: 'lib-damocles-sword-trailer-video',
  imports: [AsyncPipe, MuteIcon, PauseIcon, PlayIcon, VolumeIcon],
  templateUrl: './trailer-video.html',
  styleUrl: './trailer-video.scss',
})
export class TrailerVideo {
  private readonly _assets = inject(AssetMemory);

  private readonly _video =
    viewChild<ElementRef<HTMLVideoElement>>('trailerVideo');

  starlitLogo = this._assets.get('starlit-logo');
  starlitTrailer = this._assets.get('starlit-ascension-trailer');

  // Playback state mirrored from the <video> element via its own events, so the
  // control icons always reflect what the element is actually doing (starts
  // muted and autoplaying).
  readonly muted = signal(true);
  readonly playing = signal(true);

  toggleMute() {
    const video = this._video()?.nativeElement;

    if (video) {
      video.muted = !video.muted;
    }
  }

  togglePlayback() {
    const video = this._video()?.nativeElement;

    if (!video) {
      return;
    }

    if (video.paused) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }

  syncMuted() {
    const video = this._video()?.nativeElement;

    if (video) {
      this.muted.set(video.muted);
    }
  }

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
