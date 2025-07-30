import { TeethNumbers } from "./teeth-numbers";

export interface Tooth {
  odontogram?: string,
  number: typeof TeethNumbers[number],
  treatments?: string[]
}
