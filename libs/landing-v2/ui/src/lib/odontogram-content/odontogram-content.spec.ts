import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { OdontogramContent } from './odontogram-content';

// OdontogramContent renders DetailPageShell, whose `| rokuT` pipes read the
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
    id: '3',
    projectId: '3',
    locale: 'en',
    name: 'Odontogram',
    tags: [],
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    visual: { columnSpan: 1, featured: false },
    appLink: '/en/odontogram',
    detailLink: '/en/projects/odontogram',
    tagline: 'A dental chart',
    description: 'A description',
    ...overrides,
  };
}

describe('OdontogramContent', () => {
  let fixture: ComponentFixture<OdontogramContent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OdontogramContent],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(OdontogramContent);
    fixture.componentRef.setInput('project', makeProject());
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the project title and the live-app link', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      'Odontogram'
    );
    expect(
      host.querySelector('.detail-page__link--primary')?.getAttribute('href')
    ).toBe('/en/odontogram');
  });

  it('renders both odontogram sections and the tech chips', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.detail-section').length).toBe(2);
    expect(host.querySelectorAll('.detail-chips li').length).toBe(2);
  });
});
