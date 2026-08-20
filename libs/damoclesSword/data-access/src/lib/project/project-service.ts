import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import { Observable } from 'rxjs';
import { TranslatedProject } from './project';
import { ProjectMemory } from './project-memory';

export interface ProjectServiceI {
  getList(locale: string): Observable<TranslatedProject[]>;
}

/**
 * DI token for the damoclesSword project service, defaulting to the in-memory
 * implementation. Inject this instead of a concrete class.
 */
export const PROJECT_SERVICE = serviceToken<ProjectServiceI>(
  'PROJECT_SERVICE',
  () => inject(ProjectMemory)
);
