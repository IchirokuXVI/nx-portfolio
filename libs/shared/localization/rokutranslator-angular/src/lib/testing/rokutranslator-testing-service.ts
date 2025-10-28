import { Injectable } from '@angular/core';
import { of } from 'rxjs';

@Injectable()
export class RokuTranslatorTestingService {
  loaded$ = of(true);

  t(s: string) {
    return s;
  }
}
