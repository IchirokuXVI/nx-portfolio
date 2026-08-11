import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SiteFooter } from './site-footer';

describe('SiteFooter', () => {
  let fixture: ComponentFixture<SiteFooter>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteFooter],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SiteFooter);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the current year, never a hardcoded one (brief #6)', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.site-footer__note')?.textContent).toContain(
      String(new Date().getFullYear())
    );
    expect(fixture.componentInstance.year).toBe(new Date().getFullYear());
  });
});
