import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { PortfolioContent } from './portfolio-content';

// PortfolioContent renders DetailPageShell, whose `| rokuT` pipes read the
// translator singleton; mock it so it resolves in isolation, mirroring
// project-page.spec.ts's mock.
jest.mock('@portfolio/localization/rokutranslator', () => {
  return {
    RokuTranslator: {
      getLocale: jest.fn().mockReturnValue('en'),
      onLocaleChange: jest.fn().mockReturnValue(() => undefined),
      changeLocale: jest.fn(),
    },
  };
});

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
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the project title via the detail-page-shell', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      'Portfolio'
    );
  });

  it('renders every portfolio section and the grouped tech chips', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.detail-section').length).toBe(5);
    // 3 groups of 4 chips each.
    expect(host.querySelectorAll('.tech-chip-group__chip').length).toBe(12);
  });

  it('shows only the highlights until the reveal button is clicked', () => {
    let host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector<HTMLButtonElement>(
      '.portfolio-reveal__button'
    );

    // Highlights only: no deep blocks, button collapsed.
    expect(host.querySelectorAll('.detail-section__deep').length).toBe(0);
    expect(button?.getAttribute('aria-expanded')).toBe('false');

    button?.click();
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;

    // Every section reveals its deep block, button expanded.
    expect(host.querySelectorAll('.detail-section__deep').length).toBe(5);
    expect(button?.getAttribute('aria-expanded')).toBe('true');

    // Clicking again collapses back to highlights only.
    button?.click();
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.detail-section__deep').length).toBe(0);
  });
});
