import { Injectable } from '@angular/core';
import { Project, TranslatedProject } from '@portfolio/landing-v2/models';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { of } from 'rxjs';
import { ProjectServiceI } from './projects-service';
import { PROJECTS, StaticProject } from './static-projects-data';
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

  private resolve(project: StaticProject, locale: string): TranslatedProject {
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

    // Spread translation first so `resolved.id` (the project's own id) wins
    // over the translation row's own `id` — only `projectId` should ever
    // identify the source record on the translation side.
    return { ...translation, ...resolved } as TranslatedProject;
  }

  getList(locale: string) {
    return of<TranslatedProject[]>(
      this._projects.map((project) => this.resolve(project, locale))
    );
  }

  getById(id: string, locale: string) {
    const project = this._projects.find((p) => p.id === id);

    if (!project) {
      throw new NotFoundResourceError(
        `Project with id ${id} not found in locale ${locale}`
      );
    }

    return of(this.resolve(project, locale));
  }

  getByDetailSlug(slug: string, locale: string) {
    const project = this._projects.find((p) => p.detailSlug === slug);

    if (!project) {
      throw new NotFoundResourceError(
        `Project with detailSlug "${slug}" not found in locale ${locale}`
      );
    }

    return of(this.resolve(project, locale));
  }
}
