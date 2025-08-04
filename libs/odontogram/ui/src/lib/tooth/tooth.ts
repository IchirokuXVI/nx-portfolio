import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoadingNotifier } from '@portfolio/shared/util';

const loadable = ['image'] as const;

@Component({
  selector: 'lib-odontogram-tooth',
  imports: [CommonModule],
  templateUrl: './tooth.html',
  styleUrl: './tooth.scss',
  providers: [
    { provide: LoadingNotifier.LOADABLE_ENTRIES, useValue: loadable },
    LoadingNotifier
  ]
})
export class Tooth {

}
