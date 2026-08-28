import { AsyncPipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  PROJECT_SERVICE,
  ProjectServiceI,
  ProjectTag,
  TranslatedProject,
} from '@portfolio/damoclesSword/data-access';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { BorderAlignment } from '../enums/border-alignment';
import { SectionLayout } from '../section-layout/section-layout';

/** View model for a detailed project card (all copy already translated). */
interface DetailedProject {
  label: string;
  description: string;
  /** Resolved trailer URL, if the project has a video addon. */
  trailer?: Promise<string>;
  tags: ProjectTag[];
}

/** Adapts a translated data-access project to the detailed card's view model. */
function toDetailedProject(project: TranslatedProject): DetailedProject {
  return {
    label: project.label,
    description: project.description,
    trailer: project.addons?.find((addon) => addon.kind === 'video')?.src,
    tags: project.tags ?? [],
  };
}

@Component({
  selector: 'lib-damocles-sword-section-projects-detailed',
  imports: [AsyncPipe, RokuTranslatorPipe, SectionLayout],
  templateUrl: './section-projects-detailed.html',
  styleUrl: './section-projects-detailed.scss',
})
export class SectionProjectsDetailed implements OnInit {
  // The token, like `section-projects` beside it, rather than the concrete
  // `ProjectMemory`. The app binds the token with `provideService`, which provides the
  // implementation under the token and not under its own class name, so injecting the
  // class was reaching a root provided instance that no longer exists (rule D5).
  private readonly _projectServ: ProjectServiceI = inject(PROJECT_SERVICE);
  private readonly _i18n = inject(RokuTranslatorService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _projects = signal<TranslatedProject[]>([]);

  /** Same source as section-projects (client projects), rendered in detail. */
  readonly projects = computed<DetailedProject[]>(() =>
    this._projects()
      .filter((project) => project.kind === 'client-project')
      .map(toDetailedProject)
  );

  ngOnInit() {
    // Re-fetch the localized projects whenever the language changes at runtime.
    this._i18n
      .withLocale((locale) => this._projectServ.getList(locale))
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((projects) => this._projects.set(projects));
  }

  get BorderAlignment() {
    return BorderAlignment;
  }
}
