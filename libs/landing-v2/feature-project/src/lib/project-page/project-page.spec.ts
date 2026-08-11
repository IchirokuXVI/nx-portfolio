import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { ProjectPage } from './project-page';

jest.mock('@portfolio/localization/rokutranslator', () => {
  return {
    RokuTranslator: {
      getLocale: jest.fn().mockReturnValue('en'),
      addNamespace: jest.fn(),
      addTranslations: jest.fn(),
      removeNamespace: jest.fn(),
      // RokuTranslatorService.t() delegates to the singleton; the resolved
      // content components render real `| rokuT` pipe usages (unlike
      // LandingV2Wrapper's spec, gated behind Landing's own compReady with
      // no explicit `whenStable()` wait), so this needs to be callable too.
      t: jest.fn((key: string) => key),
    },
  };
});

function createFixture(projectId: string): ComponentFixture<ProjectPage> {
  TestBed.configureTestingModule({
    imports: [ProjectPage],
    providers: [
      provideRokuTranslatorTesting(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { data: { projectId } } },
      },
    ],
  });
  return TestBed.createComponent(ProjectPage);
}

/** Flushes change detection twice around `whenStable()`, so both the
 * `loaded$`-gated `compReady` flip and the `ProjectMemory.getById` fetch
 * (both async) have settled before assertions run. */
async function renderStable(
  fixture: ComponentFixture<ProjectPage>
): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('ProjectPage', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('should create', async () => {
    const fixture = createFixture('1');
    await renderStable(fixture);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('resolves the Portfolio content component and project for id 1', async () => {
    const fixture = createFixture('1');
    await renderStable(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('lib-landing-v2-portfolio-content')
    ).not.toBeNull();
    expect(fixture.componentInstance.project()?.name).toBe('Portfolio');
  });

  it("resolves the Damocle'Sword content component for id 2", async () => {
    const fixture = createFixture('2');
    await renderStable(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('lib-landing-v2-damocles-content')
    ).not.toBeNull();
  });

  it('resolves the Odontogram content component for id 3', async () => {
    const fixture = createFixture('3');
    await renderStable(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('lib-landing-v2-odontogram-content')
    ).not.toBeNull();
  });

  it('does not render (or throw) before the i18n namespace has loaded', () => {
    const fixture = createFixture('1');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('lib-landing-v2-portfolio-content')).toBeNull();
  });

  it('throws for an unregistered project id once ngOnInit runs', () => {
    const fixture = createFixture('does-not-exist');
    expect(() => fixture.detectChanges()).toThrow(
      /No detail-page content registered/
    );
  });
});
