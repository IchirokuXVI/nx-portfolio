import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { DetailPageShell } from './detail-page-shell';

describe('DetailPageShell', () => {
  let fixture: ComponentFixture<DetailPageShell>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailPageShell],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DetailPageShell);
    fixture.componentRef.setInput('title', 'Portfolio');
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the title', () => {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      'Portfolio'
    );
  });

  it('no longer renders a back link (the Layout header owns navigation home)', () => {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__back')).toBeNull();
  });

  it('renders the tagline only when provided', () => {
    fixture.detectChanges();
    let host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__tagline')).toBeNull();

    fixture.componentRef.setInput('tagline', 'A tagline');
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__tagline')?.textContent).toBe(
      'A tagline'
    );
  });

  it('renders the repo and live-app links only when provided', () => {
    fixture.componentRef.setInput('repoLink', 'https://github.com/x/y');
    fixture.componentRef.setInput('appLink', '/en/odontogram');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const repoLink = host.querySelector<HTMLAnchorElement>(
      '.detail-page__link:not(.detail-page__link--primary)'
    );
    const appLinkEl = host.querySelector<HTMLAnchorElement>(
      '.detail-page__link--primary'
    );

    expect(repoLink?.getAttribute('href')).toBe('https://github.com/x/y');
    expect(appLinkEl?.getAttribute('href')).toBe('/en/odontogram');
  });

  it('does not render a hero media block when no heroImage is given', () => {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__hero-media')).toBeNull();
  });
});
