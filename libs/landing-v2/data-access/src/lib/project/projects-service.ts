import { TranslatedProject } from '@portfolio/landing-v2/models';
import { Observable } from 'rxjs';

export interface ProjectServiceI {
  getList(locale: string): Observable<TranslatedProject[]>;
}
