import { TestBed } from '@angular/core/testing';
import { AssetMemory } from './asset-memory';

describe('AssetMemory', () => {
  let service: AssetMemory;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AssetMemory);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('resolves a known asset key to a url', async () => {
    // The jest asset mock stands in for the bundler-provided URL.
    await expect(service.get('starlit-logo')).resolves.toBe('asset-file-stub');
  });
});
