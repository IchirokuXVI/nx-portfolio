import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionNews } from './section-news';

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
    expect(host.querySelectorAll('lib-damocles-sword-news-card').length).toBe(
      component.news().length
    );
    expect(component.news().length).toBeGreaterThan(0);
  });
});
