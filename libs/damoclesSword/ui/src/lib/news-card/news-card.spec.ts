import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslatedNews } from '@portfolio/damoclesSword/data-access';
import { NewsCard } from './news-card';

function makeNews(overrides: Partial<TranslatedNews> = {}): TranslatedNews {
  return {
    id: '1',
    newsId: '1',
    locale: 'en',
    icon: 'calendar',
    title: 'A news title',
    description: 'A news description',
    ...overrides,
  };
}

/** Queries a single required element, failing the test if it is missing. */
function query<T extends Element>(host: HTMLElement, selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Expected to find an element matching "${selector}"`);
  }
  return el;
}

describe('NewsCard', () => {
  let component: NewsCard;
  let fixture: ComponentFixture<NewsCard>;

  async function renderWith(news: TranslatedNews) {
    fixture.componentRef.setInput('news', news);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewsCard],
    }).compileComponents();

    fixture = TestBed.createComponent(NewsCard);
    component = fixture.componentInstance;
    await renderWith(makeNews());
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the already-translated title and description directly', async () => {
    await renderWith(
      makeNews({ title: 'My headline', description: 'My body' })
    );
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.news-title')?.textContent?.trim()).toBe(
      'My headline'
    );
    expect(host.querySelector('.news-description')?.textContent?.trim()).toBe(
      'My body'
    );
  });

  it('renders the icon matching the news item', async () => {
    await renderWith(makeNews({ icon: 'home' }));
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.news-icon lib-home-icon')).not.toBeNull();
  });

  it('hides the icon slot entirely when no icon is provided', async () => {
    await renderWith(makeNews({ icon: undefined }));
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.news-icon')).toBeNull();
    expect(host.querySelector('.news-header-divider')).toBeNull();
  });

  it('renders no image when the item has none', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.news-thumbnail img')).toBeNull();
  });

  it('renders the resolved image when the item has one', async () => {
    await renderWith(makeNews({ image: 'thumbnail.png' }));
    const host = fixture.nativeElement as HTMLElement;
    const img = query<HTMLImageElement>(host, '.news-thumbnail img');
    expect(img.getAttribute('src')).toBe('thumbnail.png');
  });
});
