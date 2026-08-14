import { Injectable } from '@angular/core';
import { TeethNumbers } from '@portfolio/odontogram/models';
import { forkJoin, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ToothImageLoader {
  private loadedImages: Map<
    (typeof TeethNumbers)[number],
    Observable<{
      lateral: string;
      crown: string;
      root_mask: string;
      crown_mask: string;
    }>
  > = new Map();

  loadImage(toothNumber: (typeof TeethNumbers)[number]) {
    const loadedImage = this.loadedImages.get(toothNumber);

    if (loadedImage) {
      return loadedImage;
    }

    // FIXME: the loadedImages cache is never populated, so this Map is currently dead
    // code. The forkJoin result should be stored back into loadedImages (for example
    // wrapped in shareReplay(1) and saved with this.loadedImages.set(toothNumber, ...))
    // so repeated loads reuse the same observable. It works today only because the
    // dynamic import() is already deduped by the bundler.
    return forkJoin({
      lateral: import(`../../../assets/teeth/${toothNumber}_root.png`).then(
        (m) => m.default
      ),
      crown: import(`../../../assets/teeth/${toothNumber}_crown.png`).then(
        (m) => m.default
      ),
      root_mask: import(
        `../../../assets/teeth/${toothNumber}_root_mask.png`
      ).then((m) => m.default),
      crown_mask: import(
        `../../../assets/teeth/${toothNumber}_crown_mask.png`
      ).then((m) => m.default),
    });
  }
}
