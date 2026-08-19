import { inject } from '@angular/core';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { Observable } from 'rxjs';
import { ProjectMemory } from './projects-memory';

export interface ProjectGetListFilter {
  ids?: string[];
  searchTerm?: string | RegExp;
}

export interface ProjectServiceI {
  getList(
    locale: string,
    filter?: ProjectGetListFilter
  ): Observable<TranslatedProject[]>;
  getById(id: string, locale: string): Observable<TranslatedProject>;
  getByDetailSlug(slug: string, locale: string): Observable<TranslatedProject>;
}

/**
 * DI token for the landing-v2 project service, defaulting to the in-memory
 * implementation. Inject this instead of a concrete class.
 */
export const PROJECT_SERVICE = serviceToken<ProjectServiceI>(
  'PROJECT_SERVICE',
  () => inject(ProjectMemory)
);
