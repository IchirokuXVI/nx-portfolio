import { Component, computed, inject, OnInit, signal } from '@angular/core';
import {
  ProjectMemory,
  TranslatedProject,
} from '@portfolio/damoclesSword/data-access';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
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
  private readonly _projectServ = inject(ProjectMemory);

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
    this._projectServ
      .getList(RokuTranslator.getLocale())
      .subscribe((projects) => this._projects.set(projects));
  }

  get BorderAlignment() {
    return BorderAlignment;
  }
}
