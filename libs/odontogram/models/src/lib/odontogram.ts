export interface Odontogram {
  id: string;
  name?: string;
  client?: string;
  toothTreatments?: string[];
  additionalInformation?: string;
  generalTreatments?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}
