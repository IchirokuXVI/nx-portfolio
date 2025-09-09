import { Injectable } from '@angular/core';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { of } from 'rxjs';
import { ProjectServiceI } from './project-service';
import { PROJECTS } from './static-projects-data';

@Injectable({
  providedIn: 'root',
})
export class ProjectMemory implements ProjectServiceI {
  private _projects = PROJECTS;

  getList() {
    return of(Array.from(this._projects));
  }

  getByName(name: string) {
    const project = this._projects.find((project) => project.name === name);

    if (!project) {
      throw new NotFoundResourceError(`Project with name ${name} not found`);
    }

    return of(project);
  }
}
