import { Injectable } from "@angular/core";
import { TeethNumbers } from "@portfolio/odontogram/models";
import { forkJoin } from "rxjs/internal/observable/forkJoin";

@Injectable({ providedIn: 'root' })
export class ToothImageService {
  private teethImages: { [key in typeof TeethNumbers[number]]?: [Promise<any>, Promise<any>] } = {
    11: [import(`./11.png`), import(`./11_crown.png`)],
    // 12: [import(`../../assets/teeth/tooth-12.png`), import(`../../assets/teeth/tooth-12-crown.png`)],
    // 13: [import(`../../assets/teeth/tooth-13.png`), import(`../../assets/teeth/tooth-13-crown.png`)],
    // 14: [import(`../../assets/teeth/tooth-14.png`), import(`../../assets/teeth/tooth-14-crown.png`)],
    // 15: [import(`../../assets/teeth/tooth-15.png`), import(`../../assets/teeth/tooth-15-crown.png`)],
    // 16: [import(`../../assets/teeth/tooth-16.png`), import(`../../assets/teeth/tooth-16-crown.png`)],
    // 17: [import(`../../assets/teeth/tooth-17.png`), import(`../../assets/teeth/tooth-17-crown.png`)],
    // 18: [import(`../../assets/teeth/tooth-18.png`), import(`../../assets/teeth/tooth-18-crown.png`)],
    // 21: [import(`../../assets/teeth/tooth-21.png`), import(`../../assets/teeth/tooth-21-crown.png`)],
    // 22: [import(`../../assets/teeth/tooth-22.png`), import(`../../assets/teeth/tooth-22-crown.png`)],
    // 23: [import(`../../assets/teeth/tooth-23.png`), import(`../../assets/teeth/tooth-23-crown.png`)],
    // 24: [import(`../../assets/teeth/tooth-24.png`), import(`../../assets/teeth/tooth-24-crown.png`)],
    // 25: [import(`../../assets/teeth/tooth-25.png`), import(`../../assets/teeth/tooth-25-crown.png`)],
    // 26: [import(`../../assets/teeth/tooth-26.png`), import(`../../assets/teeth/tooth-26-crown.png`)],
    // 27: [import(`../../assets/teeth/tooth-27.png`), import(`../../assets/teeth/tooth-27-crown.png`)],
    // 28: [import(`../../assets/teeth/tooth-28.png`), import(`../../assets/teeth/tooth-28-crown.png`)],
    // 31: [import(`../../assets/teeth/tooth-31.png`), import(`../../assets/teeth/tooth-31-crown.png`)],
    // 32: [import(`../../assets/teeth/tooth-32.png`), import(`../../assets/teeth/tooth-32-crown.png`)],
    // 33: [import(`../../assets/teeth/tooth-33.png`), import(`../../assets/teeth/tooth-33-crown.png`)],
    // 34: [import(`../../assets/teeth/tooth-34.png`), import(`../../assets/teeth/tooth-34-crown.png`)],
    // 35: [import(`../../assets/teeth/tooth-35.png`), import(`../../assets/teeth/tooth-35-crown.png`)],
    // 36: [import(`../../assets/teeth/tooth-36.png`), import(`../../assets/teeth/tooth-36-crown.png`)],
    // 37: [import(`../../assets/teeth/tooth-37.png`), import(`../../assets/teeth/tooth-37-crown.png`)],
    // 38: [import(`../../assets/teeth/tooth-38.png`), import(`../../assets/teeth/tooth-38-crown.png`)],
    // 41: [import(`../../assets/teeth/tooth-41.png`), import(`../../assets/teeth/tooth-41-crown.png`)],
    // 42: [import(`../../assets/teeth/tooth-42.png`), import(`../../assets/teeth/tooth-42-crown.png`)],
    // 43: [import(`../../assets/teeth/tooth-43.png`), import(`../../assets/teeth/tooth-43-crown.png`)],
    // 44: [import(`../../assets/teeth/tooth-44.png`), import(`../../assets/teeth/tooth-44-crown.png`)],
    // 45: [import(`../../assets/teeth/tooth-45.png`), import(`../../assets/teeth/tooth-45-crown.png`)],
    // 46: [import(`../../assets/teeth/tooth-46.png`), import(`../../assets/teeth/tooth-46-crown.png`)],
    // 47: [import(`../../assets/teeth/tooth-47.png`), import(`../../assets/teeth/tooth-47-crown.png`)],
    // 48: [import(`../../assets/teeth/tooth-48.png`), import(`../../assets/teeth/tooth-48-crown.png`)],
    // 51: [import(`../../assets/teeth/tooth-51.png`), import(`../../assets/teeth/tooth-51-crown.png`)],
    // 52: [import(`../../assets/teeth/tooth-52.png`), import(`../../assets/teeth/tooth-52-crown.png`)],
    // 53: [import(`../../assets/teeth/tooth-53.png`), import(`../../assets/teeth/tooth-53-crown.png`)],
    // 54: [import(`../../assets/teeth/tooth-54.png`), import(`../../assets/teeth/tooth-54-crown.png`)],
    // 55: [import(`../../assets/teeth/tooth-55.png`), import(`../../assets/teeth/tooth-55-crown.png`)],
    // 61: [import(`../../assets/teeth/tooth-61.png`), import(`../../assets/teeth/tooth-61-crown.png`)],
    // 62: [import(`../../assets/teeth/tooth-62.png`), import(`../../assets/teeth/tooth-62-crown.png`)],
    // 63: [import(`../../assets/teeth/tooth-63.png`), import(`../../assets/teeth/tooth-63-crown.png`)],
    // 64: [import(`../../assets/teeth/tooth-64.png`), import(`../../assets/teeth/tooth-64-crown.png`)],
    // 65: [import(`../../assets/teeth/tooth-65.png`), import(`../../assets/teeth/tooth-65-crown.png`)],
    // 71: [import(`../../assets/teeth/tooth-71.png`), import(`../../assets/teeth/tooth-71-crown.png`)],
    // 72: [import(`../../assets/teeth/tooth-72.png`), import(`../../assets/teeth/tooth-72-crown.png`)],
    // 73: [import(`../../assets/teeth/tooth-73.png`), import(`../../assets/teeth/tooth-73-crown.png`)],
    // 74: [import(`../../assets/teeth/tooth-74.png`), import(`../../assets/teeth/tooth-74-crown.png`)],
    // 75: [import(`../../assets/teeth/tooth-75.png`), import(`../../assets/teeth/tooth-75-crown.png`)],
    // 81: [import(`../../assets/teeth/tooth-81.png`), import(`../../assets/teeth/tooth-81-crown.png`)],
    // 82: [import(`../../assets/teeth/tooth-82.png`), import(`../../assets/teeth/tooth-82-crown.png`)],
    // 83: [import(`../../assets/teeth/tooth-83.png`), import(`../../assets/teeth/tooth-83-crown.png`)],
    // 84: [import(`../../assets/teeth/tooth-84.png`), import(`../../assets/teeth/tooth-84-crown.png`)],
    // 85: [import(`../../assets/teeth/tooth-85.png`), import(`../../assets/teeth/tooth-85-crown.png`)]
  }

  getImage(toothNumber: typeof TeethNumbers[number]) {
    return forkJoin((this.teethImages as any)[toothNumber]);
  }
}
