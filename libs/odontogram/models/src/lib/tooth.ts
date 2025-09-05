import { Odontogram } from './odontogram';
import { TeethNumbers } from './teeth-numbers';
import { ToothTreatment } from './tooth-treatment';

export interface Tooth {
  odontogram?: Odontogram;
  number: (typeof TeethNumbers)[number];
  treatments?: ToothTreatment[];
}
