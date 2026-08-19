import { Injectable } from '@angular/core';
import { TeethNumbers } from '@portfolio/odontogram/models';
import { forkJoin, Observable, shareReplay } from 'rxjs';

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

    // shareReplay(1) so late subscribers replay the resolved value instead of
    // re-running the dynamic import()s; storing it back into loadedImages makes the
    // Map an actual per-tooth cache that lives for the app session (the service is
    // providedIn root), correct for immutable tooth assets.
    const image$ = forkJoin({
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
    }).pipe(shareReplay(1));

    this.loadedImages.set(toothNumber, image$);

    return image$;
  }
}
