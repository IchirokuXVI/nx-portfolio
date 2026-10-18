import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClearsField } from './clears-field';

@Component({
  imports: [ClearsField],
  template: `
    <input #field class="field" />
    @if (shown()) {
      <button
        (click)="shown.set(false)"
        [libClearsField]="field"
        class="cross"
        type="button"
      >
        Clear
      </button>
    }
    <input class="elsewhere" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly shown = signal(true);
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const find = <T extends HTMLElement>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (found === null) {
      throw new Error(`${selector} is not rendered`);
    }
    return found;
  };
  return { fixture, find };
}

describe('ClearsField', () => {
  it('cancels the mousedown, so a press never takes focus from the field', async () => {
    const { find } = await render();
    const press = new MouseEvent('mousedown', { cancelable: true });

    find('.cross').dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });

  it('leaves focus in the field when the field had it', async () => {
    const { fixture, find } = await render();
    const field = find<HTMLInputElement>('.field');
    field.focus();

    find('.cross').click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(field);
  });

  it('opens no keyboard: focus elsewhere stays elsewhere', async () => {
    const { fixture, find } = await render();
    const elsewhere = find<HTMLInputElement>('.elsewhere');
    elsewhere.focus();

    find('.cross').click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(elsewhere);
  });

  it('hands focus to the field when the cross itself had it, from Tab', async () => {
    const { fixture, find } = await render();
    const cross = find<HTMLButtonElement>('.cross');
    cross.focus();

    cross.click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(find('.field'));
  });
});
