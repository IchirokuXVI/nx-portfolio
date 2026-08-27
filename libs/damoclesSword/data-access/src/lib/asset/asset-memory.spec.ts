import { TestBed } from '@angular/core/testing';
import { DAMOCLES_DATA_ACCESS_PROVIDERS } from '../data-access-providers';
import { AssetMemory } from './asset-memory';

describe('AssetMemory', () => {
  let service: AssetMemory;

  beforeEach(() => {
    // The app's provider set, plus the class under test by name. The set binds each
    // token to its implementation with `provideService`, which is what these
    // services resolve each other through; `useClass` does not also make the class
    // injectable by name, and this spec is about the implementation rather than the
    // interface, so it asks for it directly (plan 0005 D5).
    TestBed.configureTestingModule({
      providers: [...DAMOCLES_DATA_ACCESS_PROVIDERS, AssetMemory],
    });
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
