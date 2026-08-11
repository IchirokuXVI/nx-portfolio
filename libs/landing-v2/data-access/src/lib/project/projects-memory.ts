import { Injectable } from '@angular/core';
import {
  Project,
  TranslatedProject,
} from '@portfolio/landing-v2/models';
import { of } from 'rxjs';
import { ProjectServiceI } from './projects-service';
import { PROJECTS } from './static-projects-data';
import { PROJECTS_TRANSLATIONS } from './static-projects-translation-data';

/**
 * In-memory project source backed by static data. Joins each project with its
 * localized copy (falling back to `en`), resolves the lazy screenshot import,
 * and builds `appLink`/`detailLink` from the locale-independent slugs — the
 * same convention as {@link ../info-fact/info-facts-memory}.
 */
@Injectable({
  providedIn: 'root',
})
export class ProjectMemory implements ProjectServiceI {
  private _projects = PROJECTS;
  private _projectsTranslations = PROJECTS_TRANSLATIONS;

  private getTranslation(projectId: string, locale: string) {
    return (
      this._projectsTranslations.find(
        (t) => t.projectId === projectId && t.locale === locale
      ) ??
      this._projectsTranslations.find(
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
        name: project.name,
        tags: project.tags,
        repoLink: project.repoLink,
        visual: project.visual,
        detailLink:
          project.detailSlug !== undefined
            ? `/${locale}/projects/${project.detailSlug}`
            : undefined,
        appLink:
          project.appSlug !== undefined
            ? `/${locale}${project.appSlug ? `/${project.appSlug}` : ''}`
            : undefined,
        image: project.image?.(),
      };

      return { ...resolved, ...translation } as TranslatedProject;
    });

    return of<TranslatedProject[]>(translatedProjects);
  }
}
