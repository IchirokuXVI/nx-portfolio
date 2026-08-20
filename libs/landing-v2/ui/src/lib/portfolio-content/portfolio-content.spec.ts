import {
  ComponentFixture,
  fakeAsync,
  TestBed,
  tick,
} from '@angular/core/testing';
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

  beforeAll(() => {
    // jsdom lacks these; the reveal toggle scrolls the host into view on expand.
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    if (!window.requestAnimationFrame) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0);
    }
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

  it('shows the five highlight sections and grouped chips, no facts table', () => {
    const host = fixture.nativeElement as HTMLElement;
    // Highlight view: deep-only sections (mf-topology, assets, testing) hidden.
    expect(host.querySelectorAll('.detail-section').length).toBe(5);
    expect(host.querySelector('#mf-topology')).toBeNull();
    // 3 chip groups of 4.
    expect(host.querySelectorAll('.tech-chip-group__chip').length).toBe(12);
    // The facts table was removed (deduped against the chips).
    expect(host.querySelector('.facts-table')).toBeNull();
  });

  it('swaps to the deep view, relocates the button, and shows the closing note', fakeAsync(() => {
    let host = fixture.nativeElement as HTMLElement;

    // Collapsed: button at the bottom, no closing note, no deep-only sections.
    expect(
      host.querySelector('.portfolio-reveal--bottom .portfolio-reveal__button')
    ).not.toBeNull();
    expect(host.querySelector('.portfolio-reveal--top')).toBeNull();
    expect(host.querySelector('.portfolio-closing')).toBeNull();

    // The swap is a fade-out, hidden content change, fade-in: flush the timer.
    host
      .querySelector<HTMLButtonElement>('.portfolio-reveal__button')
      ?.click();
    tick(200);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;

    // Expanded: all eight sections (five + three deep-only), button now at the
    // top, closing note present, aria-expanded true.
    expect(host.querySelectorAll('.detail-section').length).toBe(8);
    expect(host.querySelector('#mf-topology')).not.toBeNull();
    expect(host.querySelector('#assets')).not.toBeNull();
    expect(host.querySelector('#testing')).not.toBeNull();
    expect(
      host.querySelector('.portfolio-reveal--top .portfolio-reveal__button')
    ).not.toBeNull();
    expect(host.querySelector('.portfolio-reveal--bottom')).toBeNull();
    expect(host.querySelector('.portfolio-closing')).not.toBeNull();
    expect(
      host
        .querySelector('.portfolio-reveal__button')
        ?.getAttribute('aria-expanded')
    ).toBe('true');

    // Collapsing restores the highlight view.
    host
      .querySelector<HTMLButtonElement>('.portfolio-reveal__button')
      ?.click();
    tick(200);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.detail-section').length).toBe(5);
    expect(host.querySelector('.portfolio-closing')).toBeNull();
  }));
});
