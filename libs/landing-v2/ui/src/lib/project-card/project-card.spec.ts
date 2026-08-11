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

  it('falls back to appLink when there is no detailLink (e.g. Point Of Sale)', async () => {
    await renderWith(
      makeProject({ detailLink: undefined, appLink: '/en/point-of-sale' })
    );

    expect(fixture.componentInstance.viewLink()).toBe('/en/point-of-sale');
  });
});
