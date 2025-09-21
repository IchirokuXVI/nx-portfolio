export enum TreatmentType {
  STANDARD = 'standard',
  IMPLANT = 'implant',
  EXTRACTION = 'extraction',
}

export const TreatmentTypeTranslationKey = {
  [TreatmentType.STANDARD]: 'odontogram.treatment.standard',
  [TreatmentType.IMPLANT]: 'odontogram.treatment.implant',
  [TreatmentType.EXTRACTION]: 'odontogram.treatment.extraction',
};
