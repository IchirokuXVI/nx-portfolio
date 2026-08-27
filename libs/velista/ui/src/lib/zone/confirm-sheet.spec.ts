import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ConfirmSheet } from './confirm-sheet';

/**
 * Plan 0010 section 5.7: the typed name, which exactly one thing in this app uses.
 *
 * It is deliberate friction and it is worth its cost once. The alternative, an ordinary
 * destructive confirm, is a two tap gesture that a phone in a pocket or a misread row
 * can complete, and what it destroys belongs to other people as much as to the person
 * pressing it.
 */
@Component({
  imports: [ConfirmSheet],
  template: `
    <lib-confirm-sheet
      (confirm)="confirmed.set(confirmed() + 1)"
      [body]="'Everything goes'"
      [busy]="busy()"
      [confirmLabel]="'Delete'"
      [confirmWith]="confirmWith()"
      [title]="'Delete Flat 3B?'"
      confirmWithLabel="Type the name"
      titleId="t"
    />
  `,
})
class Host {
  readonly confirmWith = signal<string | null>(null);
  readonly busy = signal(false);
  readonly confirmed = signal(0);
}

async function render(): Promise<ComponentFixture<Host>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

function primary(fixture: ComponentFixture<Host>): HTMLButtonElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '.primary'
  ) as HTMLButtonElement;
}

function type(fixture: ComponentFixture<Host>, value: string): void {
  const field = (fixture.nativeElement as HTMLElement).querySelector(
    '.field'
  ) as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('ConfirmSheet', () => {
  describe('an ordinary confirm', () => {
    it('is ready to go with no field at all', async () => {
      const fixture = await render();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.field')
      ).toBeNull();
      expect(primary(fixture).disabled).toBe(false);
    });

    it('cannot be confirmed while a request is out', async () => {
      const fixture = await render();
      fixture.componentInstance.busy.set(true);
      fixture.detectChanges();

      expect(primary(fixture).disabled).toBe(true);
    });
  });

  describe('the typed name', () => {
    async function withTypedName(): Promise<ComponentFixture<Host>> {
      const fixture = await render();
      fixture.componentInstance.confirmWith.set('Flat 3B');
      fixture.detectChanges();
      return fixture;
    }

    it('stays disabled until the name matches', async () => {
      const fixture = await withTypedName();

      expect(primary(fixture).disabled).toBe(true);

      type(fixture, 'Flat');
      expect(primary(fixture).disabled).toBe(true);

      type(fixture, 'Flat 3B');
      expect(primary(fixture).disabled).toBe(false);
    });

    it('trims and case folds, because it is friction and not a spelling test', async () => {
      const fixture = await withTypedName();

      type(fixture, '  flat 3b  ');

      expect(primary(fixture).disabled).toBe(false);
    });

    it('does not confirm on a near miss', async () => {
      const fixture = await withTypedName();

      type(fixture, 'Flat 3C');
      primary(fixture).click();

      expect(fixture.componentInstance.confirmed()).toBe(0);
    });

    it('confirms once the name is right', async () => {
      const fixture = await withTypedName();

      type(fixture, 'Flat 3B');
      primary(fixture).click();

      expect(fixture.componentInstance.confirmed()).toBe(1);
    });
  });
});
