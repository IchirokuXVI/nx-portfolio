import { TranslatedInfoFact } from '@portfolio/landing-v2/models';
import { Observable } from 'rxjs';

export interface InfoFactServiceI {
  getList(locale: string): Observable<TranslatedInfoFact[]>;
}
