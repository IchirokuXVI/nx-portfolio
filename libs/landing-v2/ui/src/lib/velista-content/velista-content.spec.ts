import { ComponentFixture, TestBed } from '@angular/core/testing';
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

describe('VelistaContent', () => {
  let fixture: ComponentFixture<VelistaContent>;
  let host: HTMLElement;

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

  it('renders the project title', () => {
    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      'Velista'
    );
  });

  it('renders every section heading, in order', () => {
    const headings = Array.from(
      host.querySelectorAll('.detail-section__heading'),
      (heading) => heading.textContent?.trim()
    );

    expect(headings).toEqual(
      ['overview', 'stack', 'evolution', 'catalog', 'harvester', 'baskets'].map(
        (id) => `landingV2.detail.velista.sections.${id}.title`
      )
    );
  });

  it('puts the kicker only above the catalog section', () => {
    const kickers = host.querySelectorAll('.velista-section__kicker');

    expect(kickers).toHaveLength(1);
    expect(kickers[0].parentElement?.querySelector('section')?.id).toBe(
      'catalog'
    );
  });

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

  it('renders the table of contents and three chip groups', () => {
    expect(host.querySelectorAll('.detail-toc__link')).toHaveLength(6);
    expect(
      host.querySelectorAll('lib-landing-v2-tech-chip-group')
    ).toHaveLength(3);
  });
});
