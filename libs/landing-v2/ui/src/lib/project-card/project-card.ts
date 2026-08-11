import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ArrowIcon, GithubIcon } from '@portfolio/shared/ui';

@Component({
  selector: 'lib-landing-v2-project-card',
  imports: [AsyncPipe, RouterLink, RokuTranslatorPipe, ArrowIcon, GithubIcon],
  templateUrl: './project-card.html',
  styleUrl: './project-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCard {
  project = input.required<TranslatedProject>();

  /** Normalizes `image` (string | Promise<string> | undefined) to always be
   * a promise, so the template can rely on a single `| async` binding. */
  readonly imagePromise = computed<Promise<string> | undefined>(() => {
    const image = this.project().image;

    if (image === undefined) {
      return undefined;
    }

    return typeof image === 'string' ? Promise.resolve(image) : image;
  });

  /** "View project" / title / media target: the live app. `null` when the
   * project has no live app yet (e.g. POS), which disables those links. */
  readonly appLink = computed(() => this.project().appLink ?? null);

  /** "More details" target: the in-portfolio detail page. Absent for
   * projects with no detail page yet (e.g. POS). */
  readonly detailLink = computed(() => this.project().detailLink ?? null);

  /** Generic placeholder initial for image-less projects. */
  readonly initial = computed(() =>
    this.project().name.charAt(0).toUpperCase()
  );
}
