import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AccountRow } from './account-row';

/**
 * A host, because every interesting property of this row is about what its inputs do
 * to the DOM, and setting inputs through a template is how a consumer will set them.
 */
@Component({
  imports: [AccountRow],
  template: `
    <lib-account-row
      (activate)="presses.set(presses() + 1)"
      [actionLabel]="actionLabel()"
      [chevron]="chevron()"
      [chip]="chip()"
      [chipTone]="chipTone()"
      [destructive]="destructive()"
      [detail]="detail()"
      [hasAction]="hasAction()"
      [label]="label()"
      [value]="value()"
    />
  `,
})
class Host {
  readonly label = signal('');
  readonly value = signal('Marta');
  readonly detail = signal('');
  readonly hasAction = signal(false);
  readonly chevron = signal(false);
  readonly destructive = signal(false);
  readonly chip = signal('');
  readonly chipTone = signal<'ok' | 'pending'>('ok');
  readonly actionLabel = signal('');
  readonly presses = signal(0);
}

async function render(): Promise<ComponentFixture<Host>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

function button(fixture: ComponentFixture<Host>): HTMLButtonElement | null {
  return fixture.nativeElement.querySelector('button');
}

describe('AccountRow', () => {
  /**
   * The defect plan 0015 section 4.4 went looking for: the app bar's account button was
   * drawn, focusable, accessibly named, and did nothing. A row that cannot be pressed
   * must not be a control at all.
   */
  describe('what is a control and what is not', () => {
    it('renders no button when nothing is listening', async () => {
      const fixture = await render();

      expect(button(fixture)).toBeNull();
    });

    it('renders a button when there is somewhere to go', async () => {
      const fixture = await render();
      fixture.componentInstance.hasAction.set(true);
      fixture.detectChanges();

      expect(button(fixture)).not.toBeNull();
    });

    it('emits when pressed', async () => {
      const fixture = await render();
      fixture.componentInstance.hasAction.set(true);
      fixture.detectChanges();

      button(fixture)?.click();

      expect(fixture.componentInstance.presses()).toBe(1);
    });

    it('leaves the chevron off a row that opens nothing', async () => {
      const fixture = await render();
      fixture.componentInstance.hasAction.set(true);
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector('lib-chevron-right-icon')
      ).toBeNull();
    });
  });

  describe('the accessible name', () => {
    it('is the visible text by default', async () => {
      const fixture = await render();
      fixture.componentInstance.hasAction.set(true);
      fixture.detectChanges();

      expect(button(fixture)?.getAttribute('aria-label')).toBeNull();
    });

    it('is overridden when the visible text is two unrelated strings', async () => {
      // "Name / Marta" announces as a label and a value followed by "button", which
      // says nothing about what pressing it does.
      const fixture = await render();
      fixture.componentInstance.hasAction.set(true);
      fixture.componentInstance.label.set('Name');
      fixture.componentInstance.actionLabel.set('Change name');
      fixture.detectChanges();

      expect(button(fixture)?.getAttribute('aria-label')).toBe('Change name');
    });
  });

  describe('the chip', () => {
    it('is words, so it survives without the colour', async () => {
      const fixture = await render();
      fixture.componentInstance.chip.set('Not confirmed');
      fixture.componentInstance.chipTone.set('pending');
      fixture.detectChanges();

      const chip = fixture.nativeElement.querySelector('.chip') as HTMLElement;
      expect(chip.textContent).toContain('Not confirmed');
      expect(chip.classList).toContain('pending');
    });

    it('is absent when there is nothing to say', async () => {
      const fixture = await render();

      expect(fixture.nativeElement.querySelector('.chip')).toBeNull();
    });
  });

  describe('the destructive variant', () => {
    it('is a style on the row, and the label still says what it does', async () => {
      const fixture = await render();
      fixture.componentInstance.hasAction.set(true);
      fixture.componentInstance.destructive.set(true);
      fixture.componentInstance.value.set('Delete your account');
      fixture.detectChanges();

      expect(button(fixture)?.classList).toContain('destructive');
      // The half that matters: remove the styling and the meaning is unchanged.
      expect(button(fixture)?.textContent).toContain('Delete your account');
    });
  });
});
