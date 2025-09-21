import {
  ToothZones,
  Treatment,
  TreatmentType,
} from '@portfolio/odontogram/models';
import { WithRequired } from '@portfolio/shared/util';

export const TREATMENTS: readonly WithRequired<Treatment, 'id'>[] = [
  {
    id: '1',
    name: 'Standard Treatment',
    description: 'Standard dental treatment',
    treatmentType: TreatmentType.STANDARD,
    zones: [],
    updatedAt: new Date('2025-01-02'),
    createdAt: new Date('2025-01-01'),
  },
  {
    id: '2',
    name: 'Extraction',
    description: 'Tooth extraction procedure',
    treatmentType: TreatmentType.EXTRACTION,
    zones: [ToothZones.ROOT],
    updatedAt: new Date('2025-02-02'),
    createdAt: new Date('2025-02-01'),
  },
  {
    id: '3',
    name: 'Implant',
    description: 'Dental implant procedure',
    treatmentType: TreatmentType.IMPLANT,
    zones: [ToothZones.ROOT],
    updatedAt: new Date('2025-03-02'),
    createdAt: new Date('2025-03-01'),
  },
  {
    id: '4',
    name: 'Filling',
    description: 'Tooth filling procedure',
    treatmentType: TreatmentType.STANDARD,
    zones: [ToothZones.TOP, ToothZones.LATERAL],
    updatedAt: new Date('2025-04-02'),
    createdAt: new Date('2025-04-01'),
  },
];
