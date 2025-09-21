import { TranslatedProject } from '@portfolio/landing/models';
import { Observable } from 'rxjs';

export interface ProjectServiceI {
  getList(locale: string): Observable<TranslatedProject[]>;

  getByName(name: string, locale: string): Observable<TranslatedProject>;
}
