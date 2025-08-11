import { Injectable } from "@angular/core";
import { TeethNumbers } from '@portfolio/odontogram/models';
import { forkJoin, Observable } from "rxjs";

@Injectable({ providedIn: 'root' })
export class ToothImageLoader {
  private loadedImages: Map<typeof TeethNumbers[number], Observable<{ lateral: string, crown: string }>> = new Map();

  loadImage(toothNumber: typeof TeethNumbers[number]) {
    if (this.loadedImages.has(toothNumber)) {
      return this.loadedImages.get(toothNumber);
    }

    return forkJoin({
      lateral: import(`../../../assets/teeth/${toothNumber}.png`),
      crown: import(`../../../assets/teeth/${toothNumber}_crown.png`)
    });
  }
}
