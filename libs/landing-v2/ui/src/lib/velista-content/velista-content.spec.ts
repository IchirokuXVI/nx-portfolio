import {
  ComponentFixture,
  fakeAsync,
  TestBed,
  tick,
} from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { VelistaContent } from './velista-content';

function makeProject(
  overrides: Partial<TranslatedProject> = {}
): TranslatedProject {
  return {
    id: '5',
    projectId: '5',
    locale: 'en',
    name: 'Velista',
    tags: [],
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    visual: { columnSpan: 2, featured: true },
    appLink: '/velista/en',
    detailLink: '/en/projects/velista',
    tagline: 'A shared shopping list app',
    description: 'A description',
    ...overrides,
  };
}

const heading = (id: string) => `landingV2.detail.velista.sections.${id}.title`;

describe('VelistaContent', () => {
  let fixture: ComponentFixture<VelistaContent>;
  let host: HTMLElement;

  beforeAll(() => {
    // jsdom lacks requestAnimationFrame in some setups; the swap grows on one.
    if (!window.requestAnimationFrame) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0);
    }
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VelistaContent],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(VelistaContent);
    fixture.componentRef.setInput('project', makeProject());
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  const headings = () =>
    Array.from(host.querySelectorAll('.detail-section__heading'), (el) =>
      el.textContent?.trim()
    );

  it('renders the project title', () => {
    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      'Velista'
    );
  });

  it('shows the highlight sections, in order, with the chips beside the title', () => {
    expect(headings()).toEqual(
      [
        'overview',
        'stack',
        'permissions',
        'catalog',
        'curation',
        'harvester',
        'assistant',
      ].map(heading)
    );
    expect(host.querySelector('#evolution')).toBeNull();
    expect(host.querySelector('#baskets')).toBeNull();
    expect(
      host.querySelectorAll('.velista-chips lib-landing-v2-tech-chip-group')
    ).toHaveLength(3);
    expect(host.querySelectorAll('.detail-toc__link')).toHaveLength(7);
  });

  it('has no kicker above any section', () => {
    expect(host.querySelector('.velista-section__kicker')).toBeNull();
  });

  it('swaps to the deep view and back', fakeAsync(() => {
    host.querySelector<HTMLButtonElement>('.velista-reveal__button')?.click();
    tick(500);
    fixture.detectChanges();

    expect(headings()).toEqual(
      [
        'overview',
        'stack',
        'evolution',
        'permissions',
        'catalog',
        'curation',
        'harvester',
        'assistant',
        'baskets',
      ].map(heading)
    );
    expect(host.querySelector('.velista-reveal--top')).not.toBeNull();
    expect(host.querySelector('.velista-closing')).not.toBeNull();
    expect(
      host
        .querySelector('.velista-reveal__button')
        ?.getAttribute('aria-expanded')
    ).toBe('true');
    expect(
      host.querySelectorAll('#permissions .detail-section__paragraph')
    ).toHaveLength(4);

    host.querySelector<HTMLButtonElement>('.velista-reveal__button')?.click();
    tick(500);
    fixture.detectChanges();

    expect(host.querySelector('#evolution')).toBeNull();
    expect(host.querySelector('.velista-closing')).toBeNull();
  }));

  it('links the own domain in a new tab', () => {
    const link = host.querySelector<HTMLAnchorElement>('.velista-domain__link');

    expect(link?.getAttribute('href')).toBe('https://velista.app');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.textContent?.trim()).toBe('velista.app');
  });

  it('passes the relative app link through to the live app button', () => {
    expect(
      host.querySelector('.detail-page__link--primary')?.getAttribute('href')
    ).toBe('/velista/en');
  });
});
