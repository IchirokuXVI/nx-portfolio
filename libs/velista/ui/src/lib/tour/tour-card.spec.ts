import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { TourCard } from './tour-card';

async function render(
  inputs: { n?: number; total?: number; last?: boolean } = {}
): Promise<ComponentFixture<TourCard>> {
  await TestBed.configureTestingModule({
    imports: [TourCard, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(TourCard);
  fixture.componentRef.setInput('titleKey', 'tour.groups.title');
  fixture.componentRef.setInput('bodyKey', 'tour.groups.body');
  fixture.componentRef.setInput('n', inputs.n ?? 2);
  fixture.componentRef.setInput('total', inputs.total ?? 5);
  fixture.componentRef.setInput('last', inputs.last ?? false);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<TourCard>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function buttons(fixture: ComponentFixture<TourCard>): HTMLButtonElement[] {
  return Array.from(el(fixture).querySelectorAll('button'));
}

describe('TourCard', () => {
  it('renders the progress, the title, the two sentences and both buttons', async () => {
    const fixture = await render();
    const text = el(fixture).textContent ?? '';

    // The testing translator answers the key, without interpolation.
    expect(el(fixture).querySelector('.progress')?.textContent).toContain(
      'tour.progress'
    );
    expect(el(fixture).querySelector('.title')?.textContent).toContain(
      'tour.groups.title'
    );
    expect(el(fixture).querySelector('.body')?.textContent).toContain(
      'tour.groups.body'
    );
    expect(buttons(fixture).map((b) => b.textContent?.trim())).toEqual([
      'tour.skip',
      'tour.next',
    ]);
    expect(text).not.toContain('tour.finish');
  });

  it('says Finish on the last card', async () => {
    const fixture = await render({ n: 5, total: 5, last: true });

    expect(buttons(fixture)[1]?.textContent?.trim()).toBe('tour.finish');
    // Skip stays where it was, with its words, on the last card too.
    expect(buttons(fixture)[0]?.textContent?.trim()).toBe('tour.skip');
  });

  it('is a dialog labelled by its title, and takes the focus', async () => {
    const fixture = await render();
    const dialog = el(fixture).querySelector('[role="dialog"]') as HTMLElement;
    const title = el(fixture).querySelector('.title') as HTMLElement;

    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
  });

  it('says which button was pressed', async () => {
    const fixture = await render();
    const pressed: string[] = [];
    fixture.componentInstance.next.subscribe(() => pressed.push('next'));
    fixture.componentInstance.skip.subscribe(() => pressed.push('skip'));

    buttons(fixture)[1]?.click();
    buttons(fixture)[0]?.click();

    expect(pressed).toEqual(['next', 'skip']);
  });

  it('skips on Escape, which is what back does too', async () => {
    const fixture = await render();
    const skipped = jest.fn();
    fixture.componentInstance.skip.subscribe(skipped);

    el(fixture)
      .querySelector('[role="dialog"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );

    expect(skipped).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab going round its two buttons', async () => {
    const fixture = await render();
    const [skip, next] = buttons(fixture) as [
      HTMLButtonElement,
      HTMLButtonElement,
    ];

    next.focus();
    next.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    );
    expect(document.activeElement).toBe(skip);

    skip.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      })
    );
    expect(document.activeElement).toBe(next);
  });
});
