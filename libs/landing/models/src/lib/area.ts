import { AreaTranslation } from './area-translation';

export interface Area {
  id: string;
}

export type TranslatedArea = Area & AreaTranslation;
