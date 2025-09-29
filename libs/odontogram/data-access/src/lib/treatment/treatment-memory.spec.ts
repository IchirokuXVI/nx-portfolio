import { TestBed } from '@angular/core/testing';
import {
  ToothZones,
  Treatment,
  TreatmentType,
} from '@portfolio/odontogram/models';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { Optional } from '@portfolio/shared/util';
import { firstValueFrom } from 'rxjs';
import { TreatmentMemory } from './treatment-memory';
import { runSharedTreatmentServiceTests } from './treatment-service.shared-spec';

function serviceFactory() {
  TestBed.configureTestingModule({
    imports: [],
    providers: [],
  });

  const service = TestBed.inject(TreatmentMemory);

  return service;
}

runSharedTreatmentServiceTests(serviceFactory);

describe('TreatmentMemory', () => {
  let service: TreatmentMemory;
  let currentServiceData: Map<string, Treatment>;

  const mockTreatment: Optional<Treatment, 'id'> = {
    name: 'Test Treatment',
    description: 'Test description',
    treatmentType: TreatmentType.STANDARD,
    zones: [ToothZones.BOTTOM],
  };

  beforeEach(() => {
    service = serviceFactory();
    currentServiceData = service['_treatments'];
  });

  it('should read array correctly', async () => {
    const data = await firstValueFrom(service.getList());
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(currentServiceData.size);
  });

  it('should apply filter by ids', async () => {
    const data = await firstValueFrom(service.getList({ ids: ['1', '2'] }));
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((item) => item.id && ['1', '2'].includes(item.id))).toBe(
      true
    );
    expect(
      Array.from(currentServiceData.values()).filter(
        (item) => item.id === '1' || item.id === '2'
      )
    ).toEqual(data);
  });

  it('should apply filter by searchTerm', async () => {
    const regex = /^tooth/i;
    const data = await firstValueFrom(service.getList({ searchTerm: regex }));
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((item) => item.name.match(regex))).toBe(true);
    expect(
      Array.from(currentServiceData.values()).filter((item) =>
        item.name.match(regex)
      )
    ).toEqual(data);
  });

  it('should apply limit correctly', async () => {
    const data = await firstValueFrom(service.getList({ limit: 5 }));
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(5);

    const dataLessThanLimit = await firstValueFrom(
      service.getList({ limit: currentServiceData.size + 16 })
    );
    expect(dataLessThanLimit.length).toBe(currentServiceData.size);
  });

  it('should find object correctly', async () => {
    const data = await firstValueFrom(service.getById('1'));
    expect(data).toEqual(currentServiceData.get('1'));
  });

  it('should return error if not found on find', async () => {
    try {
      await firstValueFrom(service.getById('161616'));
      fail('Should have failed');
    } catch (error) {
      expect(error instanceof NotFoundResourceError).toBe(true);
    }
  });

  it('should add a new item', async () => {
    const id = '161616';
    const newItemWithId = { id, ...mockTreatment };
    const data = await firstValueFrom(service.create(newItemWithId));
    expect(data).toEqual(newItemWithId);
    expect(currentServiceData.get(newItemWithId.id)).toBeDefined();
    expect(currentServiceData.get(newItemWithId.id)).toEqual(newItemWithId);
  });

  it('should add a new item and generate id', async () => {
    const newItem = mockTreatment;
    expect(newItem.id).toBeUndefined();

    const data = await firstValueFrom(service.create(newItem));
    expect(data).toEqual({ ...newItem, id: data.id });
    expect(currentServiceData.get(data.id)).toBeDefined();
    expect(currentServiceData.get(data.id)).toEqual({
      ...newItem,
      id: data.id,
    });
  });

  it('should update an existing item', async () => {
    const updatedItem = { id: '1', name: 'Updated treatment' };
    const data = await firstValueFrom(service.update(updatedItem));
    expect(data.name).toEqual(updatedItem.name);
    expect(currentServiceData.get(updatedItem.id)?.name).toEqual(
      updatedItem.name
    );
  });

  it('should return error if not found on update', async () => {
    try {
      await firstValueFrom(
        service.update({ id: '161616', name: 'Non Existent Item' })
      );
      fail('Should have failed');
    } catch (error) {
      expect(error instanceof NotFoundResourceError).toBe(true);
    }
  });

  it('should delete an item', async () => {
    const data = await firstValueFrom(service.delete('1'));
    expect(data).toBeUndefined();
    expect(currentServiceData.get('1')).toBeUndefined();
  });
});
