import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SiteHeader } from './site-header';

describe('SiteHeader', () => {
  let component: SiteHeader;
  let fixture: ComponentFixture<SiteHeader>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteHeader],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SiteHeader);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders no navigation menu, only the brand home link and CV action (brief #1)', () => {
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('nav')).toBeNull();
    // Two anchors: the brand (links home) and the Download CV action.
    expect(host.querySelectorAll('a').length).toBe(2);
  });

  it('points the brand link at the active locale root', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('.site-header__brand')?.getAttribute('href')
    ).toBe('/en');
  });
});
