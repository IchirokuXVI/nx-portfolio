import { AsyncPipe } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'lib-damoclesSword-logo-brand',
  imports: [AsyncPipe],
  templateUrl: './logoBrand.html',
  styleUrl: './logoBrand.scss',
})
export class LogoBrand {
  damoclesLogo = import(`../../../assets/damoclesSwordLogo.svg`).then(
    (m) => m.default
  );

  centerLogo = input(false);
}
