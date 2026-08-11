import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { BehaviorSubject } from 'rxjs';
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

/** A paramMap$ we can push new slugs into, to exercise route-param reuse
 * (the router reuses this component across `projects/:slug` navigations —
 * see project-page.ts). */
function createFixture(
  slug: string
): [ComponentFixture<ProjectPage>, BehaviorSubject<ReturnType<typeof convertToParamMap>>] {
  const paramMap$ = new BehaviorSubject(convertToParamMap({ slug }));

  TestBed.configureTestingModule({
    imports: [ProjectPage],
    providers: [
      provideRokuTranslatorTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: paramMap$ } },
    ],
  });
  return [TestBed.createComponent(ProjectPage), paramMap$];
}

/** Flushes change detection twice around `whenStable()`, so both the
 * `loaded$`-gated `compReady` flip and the `ProjectMemory.getByDetailSlug`
 * fetch (both async) have settled before assertions run. */
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
    const [fixture] = createFixture('portfolio');
    await renderStable(fixture);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('resolves the Portfolio content component and project for slug "portfolio"', async () => {
    const [fixture] = createFixture('portfolio');
    await renderStable(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('lib-landing-v2-portfolio-content')
    ).not.toBeNull();
    expect(fixture.componentInstance.project()?.name).toBe('Portfolio');
  });

  it('resolves the Damocle\'Sword content component for slug "damoclesSword"', async () => {
    const [fixture] = createFixture('damoclesSword');
    await renderStable(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('lib-landing-v2-damocles-content')
    ).not.toBeNull();
  });

  it('resolves the Odontogram content component for slug "odontogram"', async () => {
    const [fixture] = createFixture('odontogram');
    await renderStable(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('lib-landing-v2-odontogram-content')
    ).not.toBeNull();
  });

  it('re-resolves when the route is reused across a slug change (no destroy/recreate)', async () => {
    const [fixture, paramMap$] = createFixture('portfolio');
    await renderStable(fixture);
    expect(fixture.componentInstance.project()?.name).toBe('Portfolio');

    paramMap$.next(convertToParamMap({ slug: 'odontogram' }));
    await renderStable(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.project()?.name).toBe('Odontogram');
    expect(
      host.querySelector('lib-landing-v2-odontogram-content')
    ).not.toBeNull();
    expect(host.querySelector('lib-landing-v2-portfolio-content')).toBeNull();
  });

  it('does not render (or throw) before the i18n namespace has loaded', () => {
    const [fixture] = createFixture('portfolio');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('lib-landing-v2-portfolio-content')).toBeNull();
  });

  it('renders nothing for an unregistered slug, without crashing the page', () => {
    // The "no content registered" guard throws (see project-page.ts), but
    // that throw happens inside the paramMap subscribe callback — Zone.js
    // reports it asynchronously rather than propagating it synchronously
    // out of detectChanges(), so the observable behavior to assert is "no
    // content got resolved", not a raised exception here.
    const [fixture] = createFixture('does-not-exist');
    fixture.detectChanges();

    expect(fixture.componentInstance.content()).toBeNull();
    expect(fixture.componentInstance.project()).toBeNull();
  });
});
