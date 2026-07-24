import { Component, input } from '@angular/core';

export enum BorderAlignment {
  CENTER = 'center',
  LEFT = 'left',
  RIGHT = 'right',
}

const BorderAlignmentClass = {
  [BorderAlignment.CENTER]: 'center-aligned',
  [BorderAlignment.LEFT]: 'left-aligned',
  [BorderAlignment.RIGHT]: 'right-aligned',
};

@Component({
  selector: 'lib-damocles-sword-double-bordered-title',
  imports: [],
  templateUrl: './double-bordered-title.html',
  styleUrl: './double-bordered-title.scss',
})
export class DoubleBorderedTitle {
  borderAlignment = input(BorderAlignment.LEFT);

  get borderAlignmentClass(): string {
    return BorderAlignmentClass[this.borderAlignment()];
  }
}
