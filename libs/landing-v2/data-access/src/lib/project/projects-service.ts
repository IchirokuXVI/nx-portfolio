import { TranslatedProject } from '@portfolio/landing-v2/models';
import { Observable } from 'rxjs';

export interface ProjectServiceI {
  getList(locale: string): Observable<TranslatedProject[]>;
  getById(id: string, locale: string): Observable<TranslatedProject>;
  /** Looks up a project by its `detailSlug` (the `projects/:slug` route
   * param) rather than its internal id — see ./static-projects-data. */
  getByDetailSlug(slug: string, locale: string): Observable<TranslatedProject>;
}
