import { Injectable } from "@angular/core";
import { TeethNumbers } from '@portfolio/odontogram/models';
import { forkJoin, Observable } from "rxjs";

@Injectable({ providedIn: 'root' })
export class ToothImageLoader {
  private loadedImages: Map<typeof TeethNumbers[number], Observable<{ lateral: string, crown: string, root_mask: string, crown_mask: string }>> = new Map();

  loadImage(toothNumber: typeof TeethNumbers[number]) {
    const loadedImage = this.loadedImages.get(toothNumber);

    if (loadedImage) {
      return loadedImage;
    }

    return forkJoin({
      lateral: import(`../../../assets/teeth/${toothNumber}_root.png`).then((m) => m.default),
      crown: import(`../../../assets/teeth/${toothNumber}_crown.png`).then((m) => m.default),
      root_mask: import(`../../../assets/teeth/${toothNumber}_root_mask.png`).then((m) => m.default),
      crown_mask: import(`../../../assets/teeth/${toothNumber}_crown_mask.png`).then((m) => m.default),
    });
  }
}
