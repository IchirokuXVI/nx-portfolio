import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ToBuyHeading } from './to-buy-heading';

async function render(
  inputs: { canReorder?: boolean; reorderHeld?: boolean } = {}
): Promise<ComponentFixture<ToBuyHeading>> {
  await TestBed.configureTestingModule({
    imports: [ToBuyHeading, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ToBuyHeading);
  fixture.componentRef.setInput('canReorder', inputs.canReorder ?? true);
  fixture.componentRef.setInput('reorderHeld', inputs.reorderHeld ?? false);
  fixture.detectChanges();
  return fixture;
}

function host(fixture: ComponentFixture<ToBuyHeading>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function message(fixture: ComponentFixture<ToBuyHeading>): string {
  return (
    host(fixture).querySelector('.held-message')?.textContent?.trim() ?? ''
  );
}

describe('ToBuyHeading (velista 0088)', () => {
  it('is a heading one level below the page title', async () => {
    const fixture = await render();

    expect(host(fixture).querySelector('h2')?.textContent).toContain(
      'list.trips.toBuy'
    );
  });

  it('offers no reorder action when reordering is not available', async () => {
    const fixture = await render({ canReorder: false });

    expect(host(fixture).querySelector('.action')).toBeNull();
  });
});

/** Velista `0082`, section 7, moved here with the action: reorder waits, and says so. */
describe('ToBuyHeading: the held reorder action', () => {
  async function held(isHeld: boolean) {
    const fixture = await render({ reorderHeld: isHeld });
    const reorder = host(fixture).querySelector<HTMLButtonElement>('.action');
    if (reorder === null) {
      throw new Error('there is no reorder action');
    }

    const started = jest.fn();
    fixture.componentInstance.startReorder.subscribe(started);
    return { fixture, reorder, started };
  }

  it('enters the mode while nothing holds it', async () => {
    const { fixture, reorder, started } = await held(false);

    reorder.click();
    fixture.detectChanges();

    expect(reorder.getAttribute('aria-disabled')).toBeNull();
    expect(started).toHaveBeenCalledTimes(1);
    expect(message(fixture)).toBe('');
  });

  it('keeps its name, is aria-disabled and not disabled, and says why on a press', async () => {
    const { fixture, reorder, started } = await held(true);

    expect(reorder.getAttribute('aria-disabled')).toBe('true');
    expect(reorder.disabled).toBe(false);
    expect(reorder.textContent).toContain('list.reorder.enter');

    reorder.click();
    fixture.detectChanges();

    expect(started).not.toHaveBeenCalled();
    expect(message(fixture)).toContain('list.reorder.unavailable');
    expect(
      host(fixture).querySelector('.held-message')?.getAttribute('aria-live')
    ).toBe('polite');
  });

  it('changes the region on every press, so each press is announced once', async () => {
    const { fixture, reorder } = await held(true);

    reorder.click();
    fixture.detectChanges();
    const first =
      host(fixture).querySelector('.held-message')?.textContent ?? '';

    reorder.click();
    fixture.detectChanges();
    const second =
      host(fixture).querySelector('.held-message')?.textContent ?? '';

    expect(second).not.toBe(first);
    expect(second.trim()).toBe(first.trim());
  });

  it('drops the sentence once the hold is lifted', async () => {
    const { fixture, reorder } = await held(true);
    reorder.click();
    fixture.detectChanges();

    fixture.componentRef.setInput('reorderHeld', false);
    fixture.detectChanges();

    expect(message(fixture)).toBe('');
  });
});
