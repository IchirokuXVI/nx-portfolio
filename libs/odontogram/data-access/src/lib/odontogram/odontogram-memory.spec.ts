import { TestBed } from '@angular/core/testing';
import { Odontogram } from '@portfolio/odontogram/models';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { firstValueFrom } from 'rxjs';
import { OdontogramMemory } from './odontogram-memory';
import { runSharedOdontogramServiceTests } from './odontogram-service.shared-spec';

function serviceFactory() {
  TestBed.configureTestingModule({
    imports: [],
    providers: [],
  });

  const service = TestBed.inject(OdontogramMemory);

  return service;
}

runSharedOdontogramServiceTests(serviceFactory);

describe('OdontogramMemory', () => {
  let service: OdontogramMemory;
  let currentServiceData: Map<string, Odontogram>;

  beforeEach(() => {
    service = serviceFactory();
    currentServiceData = service['_odontograms'];
  });

  it('should read array correctly', async () => {
    const data = await firstValueFrom(service.getList());
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(currentServiceData.size);
  });

  it('should apply filter by ids', async () => {
    const data = await firstValueFrom(service.getList({ ids: ['1', '2'] }));
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((item) => ['1', '2'].includes(item.id))).toBe(true);
    expect(
      Array.from(currentServiceData.values()).filter(
        (item) => item.id === '1' || item.id === '2'
      )
    ).toEqual(data);
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
    const newItem = { id: '161616', name: 'New Item' };
    const data = await firstValueFrom(service.create(newItem));
    expect(data).toEqual(newItem);
    expect(currentServiceData.get(newItem.id)).toBeDefined();
    expect(currentServiceData.get(newItem.id)?.name).toEqual(newItem.name);
  });

  it('should add a new item and generate id', async () => {
    const newItem = { name: 'New Item' };
    const data = await firstValueFrom(service.create(newItem));
    expect(data).toEqual({ ...newItem, id: data.id });
    expect(currentServiceData.get(data.id)).toBeDefined();
    expect(currentServiceData.get(data.id)?.name).toEqual(newItem.name);
  });

  it('should update an existing item', async () => {
    const updatedItem = { id: '1', name: 'Updated Item' };
    const data = await firstValueFrom(service.update(updatedItem));
    expect(data).toEqual(updatedItem);
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
