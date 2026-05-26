import { AsyncPipe } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'lib-damoclesSword-main-header',
  imports: [AsyncPipe, RouterModule],
  templateUrl: './main-header.html',
  styleUrl: './main-header.scss',
})
export class MainHeader {
  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  damoclesLogo = import(`../../../assets/damoclesSwordLogo.svg`).then(
    (m) => m.default
  );
}
