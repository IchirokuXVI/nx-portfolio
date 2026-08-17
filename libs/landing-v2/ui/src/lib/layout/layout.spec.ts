import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Layout } from './layout';

// Layout imports LandingV2UiModule (for its RokuTranslatorModule.withConfig
// providers), so it wires up the *real* RokuTranslatorService — mock the
// underlying singleton it drives, mirroring landing-v2-wrapper.spec.ts. The
// header's LanguageSwitch + brand home link also read getLocale() statically.
jest.mock('@portfolio/localization/rokutranslator', () => {
  return {
    RokuTranslator: {
      getLocale: jest.fn().mockReturnValue('en'),
      onLocaleChange: jest.fn().mockReturnValue(() => undefined),
      changeLocale: jest.fn(),
      addNamespace: jest.fn(),
      addTranslations: jest.fn(),
      removeNamespace: jest.fn(),
    },
  };
});

describe('Layout', () => {
  let component: Layout;
  let fixture: ComponentFixture<Layout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Layout],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Layout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a <main> with a router outlet for the child page', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('main.layout__main')).not.toBeNull();
    expect(host.querySelector('router-outlet')).not.toBeNull();
  });
});
