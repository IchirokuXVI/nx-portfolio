import { Project } from '@portfolio/landing/models';
import { Observable } from "rxjs";

export interface ProjectServiceI {
  getList(): Observable<Project[]>;

  getByName(name: string): Observable<Project>;
}
