import { Observable } from 'rxjs';
import { TranslatedNews } from './news';

export interface NewsServiceI {
  getList(locale: string): Observable<TranslatedNews[]>;
}
