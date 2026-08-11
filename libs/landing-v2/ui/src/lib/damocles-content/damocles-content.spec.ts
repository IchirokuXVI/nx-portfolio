import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { DamoclesContent } from './damocles-content';

function makeProject(
  overrides: Partial<TranslatedProject> = {}
): TranslatedProject {
  return {
    id: '2',
    projectId: '2',
    locale: 'en',
    name: "Damocle'Sword",
    tags: [],
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    visual: { columnSpan: 2, featured: true },
    appLink: '/en/damoclesSword',
    detailLink: '/en/projects/damoclesSword',
    tagline: 'A VR game studio',
    description: 'A description',
    ...overrides,
  };
}

describe('DamoclesContent', () => {
  let fixture: ComponentFixture<DamoclesContent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesContent],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesContent);
    fixture.componentRef.setInput('project', makeProject());
    fixture.componentRef.setInput('backLink', '/en');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it("renders the project title and the live-app link", () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      "Damocle'Sword"
    );
    expect(
      host.querySelector('.detail-page__link--primary')?.getAttribute('href')
    ).toBe('/en/damoclesSword');
  });

  it('renders all three damocles sections and the tech chips', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.detail-section').length).toBe(3);
    expect(host.querySelectorAll('.detail-chips li').length).toBe(4);
  });
});
