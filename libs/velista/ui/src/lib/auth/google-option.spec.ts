import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { GoogleOption } from './google-option';

async function render(termsUrl: string | null) {
  await TestBed.configureTestingModule({
    imports: [GoogleOption, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(GoogleOption);
  fixture.componentRef.setInput('termsUrl', termsUrl);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('GoogleOption (velista 0173)', () => {
  it('draws the line about the terms under its button', async () => {
    const host = await render('/en/auth/login/sheet/terms');

    const line = host.querySelector('.terms-line');
    expect(line?.textContent?.trim()).toBe('legal.accept.google');
    expect(
      host.querySelector('button')?.compareDocumentPosition(line as Node)
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('draws no line when there are no terms to accept', async () => {
    const host = await render(null);

    expect(host.querySelector('.terms-line')).toBeNull();
    expect(host.querySelector('button')).not.toBeNull();
  });
});
