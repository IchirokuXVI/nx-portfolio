import { TestBed } from '@angular/core/testing';
import { DAMOCLES_DATA_ACCESS_PROVIDERS } from '../data-access-providers';
import { AssetMemory } from './asset-memory';

describe('AssetMemory', () => {
  let service: AssetMemory;

  beforeEach(() => {
    // The whole set, not just the class under test: these services resolve each
    // other through their tokens, and none of them is `providedIn: 'root'` any
    // more (plan 0005 D5). Installing them the way the app does keeps the spec
    // honest about what the app actually provides.
    TestBed.configureTestingModule({
      providers: [...DAMOCLES_DATA_ACCESS_PROVIDERS],
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
