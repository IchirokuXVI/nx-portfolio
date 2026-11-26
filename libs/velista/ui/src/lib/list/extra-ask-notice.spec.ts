import { TestBed } from '@angular/core/testing';
import { ExtraAskNotice } from './extra-ask-notice';

/** What a count that wrote nothing says in the question's place (velista `0208`). */
describe('ExtraAskNotice (velista 0208)', () => {
  it('draws its one sentence, with no buttons and nothing to focus', async () => {
    await TestBed.configureTestingModule({
      imports: [ExtraAskNotice],
    }).compileComponents();
    const fixture = TestBed.createComponent(ExtraAskNotice);
    fixture.componentRef.setInput(
      'words',
      'The amount changed in the meantime, so nothing was counted.'
    );
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.notice')?.textContent).toBe(
      'The amount changed in the meantime, so nothing was counted.'
    );
    expect(host.querySelector('button, [tabindex]')).toBeNull();
  });
});
