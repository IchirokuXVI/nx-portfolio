import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { SupportEndedPage } from './support-ended-page';

// Velista `0133`, target 7.
describe('SupportEndedPage', () => {
  it('says the session has ended, and offers no way into the app', async () => {
    await TestBed.configureTestingModule({
      imports: [SupportEndedPage, RokuTranslatorTestingModule.forTesting()],
      providers: [provideVelistaTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(SupportEndedPage);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('support.ended.title');
    expect(host.textContent).toContain('support.ended.body');
    expect(host.querySelector('button, a')).toBeNull();
  });
});
