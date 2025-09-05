import { Observable } from 'rxjs';
import { TreatmentServiceI } from './treatment-service';
import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  ToothZones,
  TreatmentType,
  Treatment,
} from '@portfolio/odontogram/models';
import { Optional } from '@portfolio/shared/util';

export function runSharedTreatmentServiceTests(
  serviceFactory: () => TreatmentServiceI
) {
  describe('Shared TreatmentServiceI behavior', () => {
    let service: TreatmentServiceI;

    const mockTreatment: Optional<Treatment, 'id'> = {
      name: 'Test Treatment',
      description: 'Test description',
      treatmentType: TreatmentType.STANDARD,
      zones: [ToothZones.BOTTOM],
    };

    beforeEach(() => {
      service = serviceFactory();
    });

    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('getList should return an observable', () => {
      expect(service.getList() instanceof Observable).toBe(true);
    });

    it('getById should return an observable', () => {
      expect(service.getById('1') instanceof Observable).toBe(true);
    });

    it('create should return an observable', () => {
      expect(service.create(mockTreatment) instanceof Observable).toBe(true);
    });

    it('update should return an observable', () => {
      expect(
        service.update({ id: '1', name: 'Updated treatment' }) instanceof
          Observable
      ).toBe(true);
    });
  });
}
