import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ChangesBanner } from './changes-banner';

/**
 * The banner over the basket's rows (velista `0093`, section 5).
 *
 * Two things are worth asserting. It is **one real button**, because a row that
 * looks pressable and is a `div` with a click handler is unreachable from a
 * keyboard. And it is announced **politely, once per change of number**, which
 * is a wrapper with `role="status"` around the button rather than the button
 * itself: a live region that is also the control is re-announced on every focus
 * and hover.
 */
async function render(count: number) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ChangesBanner, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ChangesBanner);
  fixture.componentRef.setInput('count', count);
  fixture.detectChanges();
  return fixture;
}

describe('ChangesBanner', () => {
  it('is one real button carrying the whole sentence', async () => {
    const fixture = await render(3);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.querySelector('button')?.textContent).toContain(
      'basket.changes.banner'
    );
  });

  it('draws one sentence, whose plural is the translator’s to choose', async () => {
    // One key and one argument, so `banner_one` and `banner_other` are picked
    // by the translator rather than by a branch here. Asserted as a single
    // sentence in the button, because the testing translator echoes the key
    // and drops what it was given.
    const fixture = await render(1);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.words')?.textContent?.trim()).toBe(
      'basket.changes.banner'
    );
  });

  it('announces politely, from a wrapper rather than from the control', async () => {
    const fixture = await render(2);
    const host = fixture.nativeElement as HTMLElement;

    const region = host.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.querySelector('button')).not.toBeNull();
    expect(host.querySelector('button')?.getAttribute('role')).toBeNull();
  });

  it('hides the dot from a reader who hears the row', async () => {
    const fixture = await render(2);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.dot')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('asks the page to open the sheet, and decides nothing itself', async () => {
    const fixture = await render(2);
    const opened = jest.fn();
    fixture.componentInstance.opened.subscribe(opened);

    (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('button')?.click();

    expect(opened).toHaveBeenCalledTimes(1);
    // The count is untouched: it goes when a read says zero and never because
    // somebody pressed this.
    fixture.detectChanges();
    expect(fixture.componentInstance.count()).toBe(2);
  });
});
