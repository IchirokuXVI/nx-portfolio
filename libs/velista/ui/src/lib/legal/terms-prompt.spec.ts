import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { TermsPrompt } from './terms-prompt';

describe('TermsPrompt (velista 0173, target 8)', () => {
  it('takes focus on its heading once drawn, as it replaces the page', async () => {
    await TestBed.configureTestingModule({
      imports: [TermsPrompt, RokuTranslatorTestingModule.forTesting()],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(TermsPrompt);
    fixture.componentRef.setInput('termsUrl', '/en/terms');
    fixture.componentRef.setInput('privacyUrl', '/en/privacy');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement?.id).toBe('terms-prompt-title');
  });
});
