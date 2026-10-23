import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CheckField } from './check-field';

@Component({
  imports: [CheckField],
  template: `
    <lib-check-field [(checked)]="keep">Keep it for next time</lib-check-field>
  `,
})
class Host {
  readonly keep = signal(true);
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
