import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { ProjectGrid } from './project-grid';

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
    visual: { columnSpan: 1, featured: false },
    appLink: '/en',
    tagline: 'tagline',
    description: 'description',
    ...overrides,
  };
}

describe('ProjectGrid', () => {
  let fixture: ComponentFixture<ProjectGrid>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectGrid],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectGrid);
  });

  it('renders one project card per project in the input array, with no "x / y" counter', () => {
    fixture.componentRef.setInput('projects', [
      makeProject({ id: '1' }),
      makeProject({ id: '2' }),
      makeProject({ id: '3' }),
    ]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelectorAll('lib-landing-v2-project-card').length
    ).toBe(3);
    expect(host.querySelector('.project-grid__title')?.textContent).not.toMatch(
      /\d+\s*\/\s*\d+/
    );
  });

  it('spans the full grid width for a columnSpan: 2 project', () => {
    fixture.componentRef.setInput('projects', [
      makeProject({ id: '1', visual: { columnSpan: 2, featured: true } }),
      makeProject({ id: '2', visual: { columnSpan: 1, featured: false } }),
    ]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const items = host.querySelectorAll<HTMLElement>('.project-grid__item');

    expect(items[0].style.gridColumn).toBe('1 / -1');
    expect(items[1].style.gridColumn).toBe('');
  });
});
