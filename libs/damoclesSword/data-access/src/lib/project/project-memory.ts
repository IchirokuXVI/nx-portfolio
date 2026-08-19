import { inject, Injectable } from '@angular/core';
import { of } from 'rxjs';
import { ASSET_SERVICE } from '../asset/asset-service';
import { Project, TranslatedProject } from './project';
import { ProjectServiceI } from './project-service';
import { PROJECTS } from './static-project-data';
import { PROJECT_TRANSLATIONS } from './static-project-translation-data';

/**
 * In-memory project source backed by static data. Joins each project with its
 * localized description (falling back to `en`) and resolves each addon's asset
 * key to a URL, so consumers get ready-to-render, already-translated projects.
 * Projects never leave the client, so this is the permanent source; a server-backed
 * {@link ./project-service#ProjectServiceI} is only needed if that changes.
 */
@Injectable({
  providedIn: 'root',
})
export class ProjectMemory implements ProjectServiceI {
  private readonly _assets = inject(ASSET_SERVICE);
  private _projects = PROJECTS;
  private _projectTranslations = PROJECT_TRANSLATIONS;

  private getTranslation(projectId: string, locale: string) {
    return (
      this._projectTranslations.find(
        (t) => t.projectId === projectId && t.locale === locale
      ) ??
      this._projectTranslations.find(
        (t) => t.projectId === projectId && t.locale === 'en'
      )
    );
  }

  getList(locale: string) {
    const translatedProjects = this._projects.map((project) => {
      const translation = this.getTranslation(project.id, locale);

      if (!translation) {
        throw new Error(
          `Inconsistent data: no translation found for project ${project.id}`
        );
      }

      const resolved: Project = {
        id: project.id,
        kind: project.kind,
        label: project.label,
        addons: project.addons?.map((addon) => ({
          kind: addon.kind,
          position: addon.position,
          src: this._assets.get(addon.asset),
          alt: addon.alt,
        })),
      };

      return { ...resolved, ...translation } as TranslatedProject;
    });

    return of<TranslatedProject[]>(translatedProjects);
  }
}
