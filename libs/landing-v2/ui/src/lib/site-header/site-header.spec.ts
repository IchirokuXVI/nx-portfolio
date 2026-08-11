import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SiteHeader } from './site-header';

// SiteHeader now renders the LanguageSwitch (EN/ES toggle), which reads
// RokuTranslator.getLocale() statically at construction, mirroring
// project-page.spec.ts's mock for the same reason.
jest.mock('@portfolio/localization/rokutranslator', () => {
  return {
    RokuTranslator: {
      getLocale: jest.fn().mockReturnValue('en'),
      changeLocale: jest.fn(),
    },
  };
});

describe('SiteHeader', () => {
  let component: SiteHeader;
  let fixture: ComponentFixture<SiteHeader>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteHeader],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SiteHeader);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders no navigation links (brief #1: header has no nav)', () => {
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('nav')).toBeNull();
    // Only the Download CV action should be an anchor in the header.
    expect(host.querySelectorAll('a').length).toBe(1);
  });
});
