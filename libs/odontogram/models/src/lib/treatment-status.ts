export enum TreatmentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

export const TreatmentStatusTranslationKey = {
  [TreatmentStatus.PENDING]: 'odontogram.treatment.status.pending',
  [TreatmentStatus.COMPLETED]: 'odontogram.treatment.status.completed'
};
