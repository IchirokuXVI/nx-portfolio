import { TestBed } from '@angular/core/testing';
import { LeaveQuestion } from './leave-question';

async function render() {
  await TestBed.configureTestingModule({
    imports: [LeaveQuestion],
  }).compileComponents();
  const fixture = TestBed.createComponent(LeaveQuestion);
  fixture.componentRef.setInput('question', 'Leave without saving?');
  fixture.componentRef.setInput('stayLabel', 'Keep choosing');
  fixture.componentRef.setInput('leaveLabel', 'Leave');
  const answers: string[] = [];
  fixture.componentInstance.stay.subscribe(() => answers.push('stay'));
  fixture.componentInstance.leave.subscribe(() => answers.push('leave'));
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, answers, host: fixture.nativeElement as HTMLElement };
}

describe('LeaveQuestion (velista 0146, section 4)', () => {
  it('asks as an alert dialog named by its question, with the safe answer focused', async () => {
    const { host } = await render();

    const dialog = host.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(
      host.querySelector(`#${dialog?.getAttribute('aria-labelledby')}`)
        ?.textContent
    ).toContain('Leave without saving?');
    expect(document.activeElement?.textContent).toContain('Keep choosing');
  });

  it('answers each button, and Escape keeps choosing', async () => {
    const { host, answers } = await render();

    host.querySelector<HTMLButtonElement>('button.keep')?.click();
    host.querySelector<HTMLButtonElement>('button.leave')?.click();
    host.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

    expect(answers).toEqual(['stay', 'leave', 'stay']);
  });

  it('keeps Tab inside the card, both ways', async () => {
    const { host } = await render();
    const keep = host.querySelector<HTMLButtonElement>('button.keep');
    const leave = host.querySelector<HTMLButtonElement>('button.leave');
    const tab = (from: HTMLElement | null, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      from?.dispatchEvent(event);
      return event;
    };

    leave?.focus();
    expect(tab(leave).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(keep);

    expect(tab(keep, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(leave);

    keep?.focus();
    expect(tab(keep).defaultPrevented).toBe(false);
  });

  it('gives the focus back to the control that asked', async () => {
    const asker = document.createElement('button');
    document.body.appendChild(asker);
    asker.focus();

    const { fixture } = await render();
    fixture.destroy();

    expect(document.activeElement).toBe(asker);
    asker.remove();
  });
});
