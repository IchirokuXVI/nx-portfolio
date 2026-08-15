import { Injectable } from '@angular/core';
import { of } from 'rxjs';

@Injectable()
export class RokuTranslatorTestingService {
  loaded$ = of(true);

  t(key: string, _ns?: string) {
    return key;
  }
}
