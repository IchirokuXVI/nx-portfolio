import { TranslatedProject } from '@portfolio/landing-v2/models';
import { Observable } from 'rxjs';

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
