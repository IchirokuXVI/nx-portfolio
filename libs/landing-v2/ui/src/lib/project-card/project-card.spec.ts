import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { ProjectCard } from './project-card';

function makeProject(
  overrides: Partial<TranslatedProject> = {}
): TranslatedProject {
  return {
    id: '1',
    projectId: '1',
    locale: 'en',
    name: 'Portfolio',
    tags: ['Angular', 'Nx'],
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    visual: { columnSpan: 1, featured: false },
    detailLink: '/en/projects/portfolio',
    appLink: '/en',
    tagline: 'A tagline',
    description: 'A description',
    ...overrides,
  };
}

describe('ProjectCard', () => {
  let fixture: ComponentFixture<ProjectCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectCard],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectCard);
  });

  async function renderWith(project: TranslatedProject) {
    fixture.componentRef.setInput('project', project);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('should create', async () => {
    await renderWith(makeProject());
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders name, tagline, description and tags from the project input', async () => {
    await renderWith(makeProject());
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.project-card__title')?.textContent).toContain(
      'Portfolio'
    );
    expect(
      host.querySelector('.project-card__tagline')?.textContent?.trim()
    ).toBe('A tagline');
    expect(
      host.querySelector('.project-card__description')?.textContent?.trim()
    ).toBe('A description');
    expect(host.querySelectorAll('.project-card__tags li').length).toBe(2);
  });

  it('renders the generic placeholder when the project has no image', async () => {
    await renderWith(makeProject({ image: undefined }));
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('img')).toBeNull();
    expect(
      host.querySelector('.project-card__placeholder-initial')?.textContent
    ).toBe('P');
  });

  it('renders the screenshot when the project has an image', async () => {
    await renderWith(makeProject({ image: 'screenshot.png' }));
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'screenshot.png'
    );
  });

  it('links the title and "View project" to the live app', async () => {
    await renderWith(makeProject({ appLink: '/en' }));
    const host = fixture.nativeElement as HTMLElement;

    const titleLink = host.querySelector<HTMLAnchorElement>(
      '.project-card__title a:first-child'
    );
    expect(titleLink?.getAttribute('href')).toBe('/en');

    const views = host.querySelectorAll<HTMLAnchorElement>(
      '.project-card__actions .project-card__view'
    );
    // Last action is "View project" → app link.
    expect(views[views.length - 1]?.getAttribute('href')).toBe('/en');

    // The image also links to the live app.
    expect(
      host.querySelector('.project-card__media')?.getAttribute('href')
    ).toBe('/en');
  });

  it('links "More details" to the detail page when present', async () => {
    await renderWith(
      makeProject({ detailLink: '/en/projects/portfolio', appLink: '/en' })
    );
    const host = fixture.nativeElement as HTMLElement;

    const views = host.querySelectorAll<HTMLAnchorElement>(
      '.project-card__actions .project-card__view'
    );
    expect(views.length).toBe(2);
    // First action is "More details" → detail link.
    expect(views[0]?.getAttribute('href')).toBe('/en/projects/portfolio');
  });

  it('omits "More details" when there is no detailLink', async () => {
    await renderWith(
      makeProject({ detailLink: undefined, appLink: '/en/odontogram' })
    );
    const host = fixture.nativeElement as HTMLElement;

    const views = host.querySelectorAll<HTMLAnchorElement>(
      '.project-card__actions .project-card__view'
    );
    expect(views.length).toBe(1);
    expect(views[0]?.getAttribute('href')).toBe('/en/odontogram');
  });

  it('disables the app links and shows the unavailable tooltip when there is no appLink (e.g. Point Of Sale)', async () => {
    await renderWith(
      makeProject({ detailLink: undefined, appLink: undefined })
    );
    const host = fixture.nativeElement as HTMLElement;

    // Image and title are rendered but not clickable (no href).
    expect(
      host.querySelector('.project-card__media')?.getAttribute('href')
    ).toBeNull();
    expect(
      host.querySelector('.project-card__name')?.getAttribute('href')
    ).toBeNull();

    // "View project" is a disabled, non-anchor control carrying the tooltip.
    const disabled = host.querySelector('.project-card__view--disabled');
    expect(disabled).not.toBeNull();
    expect(disabled?.tagName).toBe('SPAN');
    expect(disabled?.getAttribute('data-tooltip')).toBe(
      'landingV2.project_unavailable'
    );
    expect(
      host.querySelectorAll('.project-card__actions a.project-card__view')
        .length
    ).toBe(0);
  });
});
