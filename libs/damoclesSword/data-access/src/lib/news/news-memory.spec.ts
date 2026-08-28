import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { DAMOCLES_DATA_ACCESS_PROVIDERS } from '../data-access-providers';
import { NewsMemory } from './news-memory';
import { NEWS } from './static-news-data';

describe('NewsMemory', () => {
  let service: NewsMemory;

  beforeEach(() => {
    // The app's provider set, plus the class under test by name. The set binds each
    // token to its implementation with `provideService`, which is what these
    // services resolve each other through; `useClass` does not also make the class
    // injectable by name, and this spec is about the implementation rather than the
    // interface, so it asks for it directly (plan 0005 D5).
    TestBed.configureTestingModule({
      providers: [...DAMOCLES_DATA_ACCESS_PROVIDERS, NewsMemory],
    });
    service = TestBed.inject(NewsMemory);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('joins each news item with its translation for the requested locale', async () => {
    const news = await firstValueFrom(service.getList('es'));

    expect(news).toHaveLength(NEWS.length);
    expect(news[0]).toEqual(
      expect.objectContaining({
        newsId: '1',
        icon: 'calendar',
        locale: 'es',
        title: '¿Listo para probar Starlit VS?',
      })
    );
  });

  it('falls back to the English translation for an unknown locale', async () => {
    const news = await firstValueFrom(service.getList('de'));

    expect(news[0]).toEqual(
      expect.objectContaining({
        newsId: '1',
        locale: 'en',
        title: 'Ready to try out Starlit VS?',
      })
    );
  });

  it('resolves each item image asset to a url', async () => {
    const news = await firstValueFrom(service.getList('en'));

    // The jest asset mock stands in for the bundler-provided URL.
    await expect(Promise.resolve(news[0].image)).resolves.toBe(
      'asset-file-stub'
    );
  });
});
