import { inject, Pipe, PipeTransform } from '@angular/core';
import { RokuTranslatorService } from './rokutranslator-service';

@Pipe({
  name: 'rokuT',
})
export class RokuTranslatorPipe implements PipeTransform {
  private _serv = inject(RokuTranslatorService);

  transform(key: string): string {
    return this._serv.t(key);
  }
}
