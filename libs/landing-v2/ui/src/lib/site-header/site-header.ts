import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DownloadIcon } from '@portfolio/shared/ui';

/**
 * The header keeps the brand mark and the Download CV action, but drops
 * navigation links entirely (brief #1) — the page is a single scroll, so a
 * nav added nothing.
 */
@Component({
  selector: 'lib-landing-v2-site-header',
  imports: [AsyncPipe, RokuTranslatorPipe, DownloadIcon],
  templateUrl: './site-header.html',
  styleUrl: './site-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeader {
  resumeLink = input<Promise<string> | null>(null);
}
