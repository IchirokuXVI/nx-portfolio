import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ConfirmDialog } from './confirm-dialog';

/**
 * Which button of the question is filled.
 *
 * One filled button says which answer the operator is led to. Two say
 * nothing, which is what the start over a red probe of admin plan 0069 drew
 * before: `prefer="dismiss"` filled "Cancel" and `tone="primary"` filled
 * "Start anyway".
 */

async function render(
  inputs: Readonly<Record<string, unknown>>
): Promise<ComponentFixture<ConfirmDialog>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ConfirmDialog, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ConfirmDialog);
  fixture.componentRef.setInput('headingKey', 'question.heading');
  fixture.componentRef.setInput('bodyKey', 'question.body');
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();
  return fixture;
}

const button = (
  fixture: ComponentFixture<ConfirmDialog>,
  which: 'confirm' | 'dismiss'
): HTMLButtonElement => {
  const found = (fixture.nativeElement as HTMLElement).querySelector(
    `[data-${which}]`
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`no ${which} button`);
  }
  return found;
};

describe('the buttons of a question', () => {
  it('fills only the dismissing button when a primary act prefers dismiss', async () => {
    const fixture = await render({ prefer: 'dismiss', tone: 'primary' });

    expect(button(fixture, 'dismiss').classList).toContain('primary');
    // Plain, and not red: going through with it is allowed, only not led to.
    expect(button(fixture, 'confirm').classList).not.toContain('primary');
    expect(button(fixture, 'confirm').classList).not.toContain('danger');
    expect(document.activeElement).toBe(button(fixture, 'dismiss'));
  });

  it('fills the button that goes through with a primary act it prefers', async () => {
    const fixture = await render({ tone: 'primary' });

    expect(button(fixture, 'confirm').classList).toContain('primary');
    expect(button(fixture, 'dismiss').classList).not.toContain('primary');
  });

  it('keeps a destructive act red when it prefers dismiss', async () => {
    const fixture = await render({ prefer: 'dismiss' });

    expect(button(fixture, 'confirm').classList).toContain('danger');
    expect(button(fixture, 'confirm').classList).not.toContain('primary');
    expect(button(fixture, 'dismiss').classList).toContain('primary');
  });
});
