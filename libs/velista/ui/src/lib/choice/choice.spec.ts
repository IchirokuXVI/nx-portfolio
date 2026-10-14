import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CheckField } from './check-field';
import { RadioRow } from './radio-row';

@Component({
  imports: [CheckField, RadioRow],
  template: `
    <lib-check-field [(checked)]="keep">Keep it for next time</lib-check-field>
    @for (option of options; track option) {
      <lib-radio-row
        (chosen)="chosen.set(option)"
        [checked]="chosen() === option"
        name="product"
      >
        <span class="name">{{ option }}</span>
      </lib-radio-row>
    }
  `,
})
class Host {
  readonly keep = signal(true);
  readonly chosen = signal('milk');
  readonly options = ['milk', 'oat'];
}

async function render() {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

describe('CheckField', () => {
  it('is a native checkbox whose whole row is its label', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;
    const label = host.querySelector('lib-check-field label');

    expect(label?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(label?.textContent).toContain('Keep it for next time');
  });

  it('starts as it is bound and writes the box back', async () => {
    const fixture = await render();
    const box = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(true);

    box?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.keep()).toBe(false);
  });
});

describe('RadioRow', () => {
  it('draws native radios of one group, with what the caller projects', async () => {
    const fixture = await render();
    const radios = [
      ...(
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ];

    expect(radios.map((radio) => radio.name)).toEqual(['product', 'product']);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        'lib-radio-row .name'
      )?.textContent
    ).toBe('milk');
  });

  it('says it was chosen', async () => {
    const fixture = await render();
    const radios = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLInputElement>('input[type="radio"]');

    radios[1].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.chosen()).toBe('oat');
    expect(radios[1].checked).toBe(true);
  });
});
