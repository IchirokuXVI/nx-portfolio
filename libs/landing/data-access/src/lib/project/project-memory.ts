import { Injectable } from '@angular/core';
import { Project, ProjectTranslation } from '@portfolio/landing/models';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { of } from 'rxjs';
import { ProjectServiceI } from './project-service';
import { PROJECTS } from './static-projects-data';
import { PROJECTS_TRANSLATIONS } from './static-projects-translation-data';

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

      return { ...project, ...translation } as Project & ProjectTranslation;
    });

    return of(translatedProjects);
  }

  getByName(name: string, locale: string) {
    let translation = this._projectsTranslations.find(
      (t) => t.name === name && t.locale === locale
    );

    if (!translation) {
      // fallback by checking English name
      translation = this._projectsTranslations.find(
        (t) => t.name === name && t.locale === 'en'
      );
    }

    if (!translation) {
      throw new NotFoundResourceError(
        `Project with name ${name} not found in locale ${locale}, nor fallback 'en'`
      );
    }

    const project = this._projects.find((p) => p.id === translation!.projectId);

    if (!project) {
      throw new Error(
        `Inconsistent data: translation found but no project data for ${translation.projectId}`
      );
    }

    return of({ ...project, ...translation });
  }
}
