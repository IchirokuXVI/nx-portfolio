import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { NewsMemory } from './news-memory';
import { NEWS } from './static-news-data';

describe('NewsMemory', () => {
  let service: NewsMemory;

  beforeEach(() => {
    TestBed.configureTestingModule({});
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
