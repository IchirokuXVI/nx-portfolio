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
  ProjectMemory,
  TranslatedProject,
} from '@portfolio/damoclesSword/data-access';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { BorderAlignment } from '../enums/border-alignment';
import { ProjectCard, ProjectData } from '../project-card/project-card';
import { SectionLayout } from '../section-layout/section-layout';

/** Adapts a translated data-access project (assets resolved) to the card input. */
function toProjectData(project: TranslatedProject): ProjectData {
  return {
    kind: project.kind,
    label: project.label,
    description: project.description,
    addons: project.addons?.map((addon) => ({
      kind: addon.kind,
      position: addon.position,
      src: addon.src,
      alt: addon.alt,
    })),
  };
}

@Component({
  selector: 'lib-damocles-sword-section-projects',
  imports: [RokuTranslatorPipe, ProjectCard, SectionLayout],
  templateUrl: './section-projects.html',
  styleUrl: './section-projects.scss',
})
export class SectionProjects implements OnInit {
  // TODO(di-wiring): injected as a concrete implementation instead of via a DI token bound to the service interface, so the real/API impl cannot be swapped without editing here. Tracked in libs/shared/data-access/plans/0001-data-access-di-token-wiring.md
  private readonly _projectServ = inject(ProjectMemory);
  private readonly _i18n = inject(RokuTranslatorService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _projects = signal<TranslatedProject[]>([]);

  readonly clientProjects = computed<ProjectData[]>(() =>
    this._projects()
      .filter((project) => project.kind === 'client-project')
      .map(toProjectData)
  );

  readonly games = computed<ProjectData[]>(() =>
    this._projects()
      .filter((project) => project.kind === 'game')
      .map(toProjectData)
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
