import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionNews } from './section-news';

// The component reads the active locale from the RokuTranslator singleton in
// `ngOnInit`; stub it to `en` so the news service returns the mocked list.
jest.mock('@portfolio/localization/rokutranslator', () => ({
  RokuTranslator: {
    getLocale: jest.fn().mockReturnValue('en'),
  },
}));

describe('SectionNews', () => {
  let component: SectionNews;
  let fixture: ComponentFixture<SectionNews>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionNews],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionNews);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a card per mocked news item', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('lib-damoclesSword-news-card').length).toBe(
      component.news().length
    );
    expect(component.news().length).toBeGreaterThan(0);
  });

  it('renders a "see more" CTA pointing at the current page', () => {
    const host = fixture.nativeElement as HTMLElement;
    const link = host.querySelector<HTMLAnchorElement>(
      '.see-more-button .call-to-action-button'
    );
    expect(link).not.toBeNull();
    // `[link]="[]"` keeps the user on the current route for now.
    expect(link?.getAttribute('href')).toBe('/');
  });
});
