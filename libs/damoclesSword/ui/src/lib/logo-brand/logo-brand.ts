import { AsyncPipe } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'lib-damocles-sword-logo-brand',
  imports: [AsyncPipe],
  templateUrl: './logo-brand.html',
  styleUrl: './logo-brand.scss',
})
export class LogoBrand {
  damoclesLogo = import(`../../../assets/damoclesSwordLogo.svg`).then(
    (m) => m.default
  );

  centerLogo = input(false);
}
