import { Observable } from 'rxjs';
import { TranslatedProject } from './project';

export interface ProjectServiceI {
  getList(locale: string): Observable<TranslatedProject[]>;
}
