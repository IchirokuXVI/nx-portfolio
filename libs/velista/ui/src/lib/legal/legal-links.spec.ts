import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { LegalLinks } from './legal-links';

describe('LegalLinks (velista 0172, target 7)', () => {
  async function render(): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LegalLinks, RokuTranslatorTestingModule.forTesting()],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(LegalLinks);
    fixture.componentRef.setInput('privacyUrl', '/es/privacy');
    fixture.componentRef.setInput('termsUrl', '/es/terms');
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('links the policy first and the terms second, at the addresses it was given', async () => {
    const root = await render();

    const links = Array.from(root.querySelectorAll('a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/es/privacy',
      '/es/terms',
    ]);
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'legal.link.privacy',
      'legal.link.terms',
    ]);
  });

  it('is a named navigation landmark', async () => {
    const root = await render();

    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'legal.links'
    );
  });
});
