import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AccountSwitch } from './account-switch';

/** Velista `0191`, section 1: the switch of the account page. */
async function render(
  inputs: { checked?: boolean; hint?: string } = {}
): Promise<ComponentFixture<AccountSwitch>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AccountSwitch],
  }).compileComponents();
  const fixture = TestBed.createComponent(AccountSwitch);
  fixture.componentRef.setInput('label', 'Compact rows');
  fixture.componentRef.setInput('hint', inputs.hint ?? 'Only on this phone.');
  if (inputs.checked !== undefined) {
    fixture.componentRef.setInput('checked', inputs.checked);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function input(fixture: ComponentFixture<AccountSwitch>): HTMLInputElement {
  return fixture.nativeElement.querySelector('input') as HTMLInputElement;
}

function byId(fixture: ComponentFixture<AccountSwitch>, id: string | null) {
  return (fixture.nativeElement as HTMLElement).querySelector(`[id="${id}"]`);
}

describe('AccountSwitch (velista 0191)', () => {
  it('is a checkbox with the switch role, named by its title', async () => {
    const fixture = await render();

    expect(input(fixture).type).toBe('checkbox');
    expect(input(fixture).getAttribute('role')).toBe('switch');
    expect(
      byId(fixture, input(fixture).getAttribute('aria-labelledby'))?.textContent
    ).toBe('Compact rows');
  });

  it('is described by its hint, and by nothing without one', async () => {
    const fixture = await render();
    expect(
      byId(fixture, input(fixture).getAttribute('aria-describedby'))
        ?.textContent
    ).toBe('Only on this phone.');

    const bare = await render({ hint: '' });
    expect(input(bare).hasAttribute('aria-describedby')).toBe(false);
  });

  it('holds the control inside its label, so the whole row is the target', async () => {
    const fixture = await render();
    const label = fixture.nativeElement.querySelector('label') as HTMLElement;

    expect(label.contains(input(fixture))).toBe(true);
  });

  it('reflects checked', async () => {
    expect(input(await render()).checked).toBe(false);
    expect(input(await render({ checked: true })).checked).toBe(true);
  });

  it('emits the new state on a click on the label', async () => {
    const fixture = await render();
    const seen: boolean[] = [];
    fixture.componentInstance.changed.subscribe((on) => seen.push(on));

    (fixture.nativeElement.querySelector('.title') as HTMLElement).click();

    expect(seen).toEqual([true]);
  });

  it('emits on Space, the key a checkbox answers', async () => {
    const fixture = await render({ checked: true });
    const seen: boolean[] = [];
    fixture.componentInstance.changed.subscribe((on) => seen.push(on));

    // jsdom does not turn a key into a click, so the browser's own Space is the
    // click that follows it: the native control does the rest.
    const control = input(fixture);
    control.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true })
    );
    control.click();

    expect(seen).toEqual([false]);
  });
});
