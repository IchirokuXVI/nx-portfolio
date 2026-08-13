import { AsyncPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import {
  ProjectMemory,
  ProjectTag,
  TranslatedProject,
} from '@portfolio/damoclesSword/data-access';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
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
  private readonly _projectServ = inject(ProjectMemory);

  private readonly _projects = signal<TranslatedProject[]>([]);

  /** Same source as section-projects (client projects), rendered in detail. */
  readonly projects = computed<DetailedProject[]>(() =>
    this._projects()
      .filter((project) => project.kind === 'client-project')
      .map(toDetailedProject)
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
