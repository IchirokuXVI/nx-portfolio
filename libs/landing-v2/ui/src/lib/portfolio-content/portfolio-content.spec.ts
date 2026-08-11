import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { PortfolioContent } from './portfolio-content';

function makeProject(
  overrides: Partial<TranslatedProject> = {}
): TranslatedProject {
  return {
    id: '1',
    projectId: '1',
    locale: 'en',
    name: 'Portfolio',
    tags: [],
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    visual: { columnSpan: 2, featured: true },
    appLink: '/en',
    detailLink: '/en/projects/portfolio',
    tagline: 'This site',
    description: 'A description',
    ...overrides,
  };
}

describe('PortfolioContent', () => {
  let fixture: ComponentFixture<PortfolioContent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PortfolioContent],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(PortfolioContent);
    fixture.componentRef.setInput('project', makeProject());
    fixture.componentRef.setInput('backLink', '/en');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the project title and back link via the detail-page-shell', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      'Portfolio'
    );
    expect(
      host.querySelector('.detail-page__back')?.getAttribute('href')
    ).toBe('/en');
  });

  it('renders all three portfolio sections and the tech chips', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.detail-section').length).toBe(3);
    expect(host.querySelectorAll('.detail-chips li').length).toBe(8);
  });
});
