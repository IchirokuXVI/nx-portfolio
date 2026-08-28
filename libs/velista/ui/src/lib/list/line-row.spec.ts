import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { LineRowVm } from '@portfolio/velista/models';
import { LineRow } from './line-row';

/**
 * Plan 0012 section 7, the accessibility rules, which are the ones a screenshot cannot
 * check and a refactor is most likely to quietly break.
 */
function vm(overrides: Partial<LineRowVm> = {}): LineRowVm {
  return {
    id: 'ln-1',
    content: 'Sourdough loaf',
    quantity: 1,
    status: 'PENDING',
    approvalStatus: 'APPROVED',
    struck: false,
    captionKey: null,
    write: 'none',
    overwrittenBy: null,
    interactive: true,
    actions: ['edit', 'markNotAvailable', 'comments', 'delete'],
    decidable: false,
    restorable: false,
    editor: null,
    ...overrides,
  };
}

async function render(
  line: LineRowVm,
  inputs: { reordering?: boolean } = {}
): Promise<ComponentFixture<LineRow>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [LineRow, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(LineRow);
  fixture.componentRef.setInput('line', line);
  if (inputs.reordering !== undefined) {
    fixture.componentRef.setInput('reordering', inputs.reordering);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

function row(fixture: ComponentFixture<LineRow>): HTMLElement {
  return fixture.nativeElement.querySelector('.row') as HTMLElement;
}

describe('LineRow', () => {
  // Plan 0022, section 3.4. The one thing this indicator must never become is a
  // guard, so the tests are as much about what does not change as about what draws.
  describe('somebody else editing', () => {
    it('draws their initial and the word, and nothing when nobody is', async () => {
      const editing = await render(vm({ editor: 'Ana' }));
      const quiet = await render(vm());

      expect(
        editing.nativeElement.querySelector('.editor')?.textContent
      ).toContain('A');
      expect(quiet.nativeElement.querySelector('.editor')).toBeNull();
    });

    // Slicing a string cuts a surrogate pair in half, and a name that starts with an
    // emoji would render the replacement character. Every initial in this app is a
    // code point for that reason.
    it('takes the initial as a code point', async () => {
      const fixture = await render(vm({ editor: '\u{1F600}na' }));

      expect(
        fixture.nativeElement.querySelector('.editor-avatar')?.textContent
      ).toBe('\u{1F600}');
    });

    // Advisory, per section 3: no lock, no disabled control, no warning. The row is
    // exactly the row it was.
    it('leaves the row a tappable checkbox', async () => {
      const fixture = await render(vm({ editor: 'Ana' }));
      const ticked: string[] = [];
      fixture.componentInstance.ticked.subscribe((id) => ticked.push(id));

      expect(row(fixture).getAttribute('role')).toBe('checkbox');
      expect(row(fixture).getAttribute('tabindex')).toBe('0');

      row(fixture).click();
      expect(ticked).toEqual(['ln-1']);
    });

    // The name would be read out on every visit to the row and would go stale between
    // two of them. The captions lost the same argument and went to `aria-describedby`.
    it('stays out of the accessible name of the row', async () => {
      const fixture = await render(vm({ editor: 'Ana' }));

      expect(row(fixture).getAttribute('aria-label')).toBe('Sourdough loaf');
      expect(
        fixture.nativeElement
          .querySelector('.editor')
          ?.getAttribute('aria-hidden')
      ).toBe('true');
    });
  });

  describe('the row is a checkbox', () => {
    it('carries the role and reflects READY in aria-checked', async () => {
      const fixture = await render(vm({ status: 'READY' }));

      expect(row(fixture).getAttribute('role')).toBe('checkbox');
      expect(row(fixture).getAttribute('aria-checked')).toBe('true');
    });

    it('is unchecked while the line is still to get', async () => {
      const fixture = await render(vm({ status: 'PENDING' }));

      expect(row(fixture).getAttribute('aria-checked')).toBe('false');
    });

    it('treats NOT_AVAILABLE as unchecked, not as a third state', async () => {
      // There is no third checkbox state, and `mixed` means something else entirely.
      // The caption carries the distinction, in the description.
      const fixture = await render(
        vm({ status: 'NOT_AVAILABLE', captionKey: 'list.line.notAvailable' })
      );

      expect(row(fixture).getAttribute('aria-checked')).toBe('false');
      expect(row(fixture).getAttribute('aria-describedby')).toBe('cap-ln-1');
    });
  });

  describe('the accessible name', () => {
    it('is the content alone when there is one of something', async () => {
      const fixture = await render(vm({ quantity: 1 }));

      expect(row(fixture).getAttribute('aria-label')).toBe('Sourdough loaf');
    });

    it('includes the quantity exactly when the quantity is drawn', async () => {
      const fixture = await render(vm({ quantity: 2 }));

      expect(row(fixture).getAttribute('aria-label')).toBe('Sourdough loaf, 2');
      expect(fixture.nativeElement.textContent).toContain('2');
    });

    it('does not grow the caption into the name', async () => {
      // A name that grew "Waiting for approval" would be read out every time focus
      // touched the row. The caption is a description, on demand.
      const fixture = await render(
        vm({
          approvalStatus: 'PENDING',
          captionKey: 'list.line.awaitingApproval',
        })
      );

      expect(row(fixture).getAttribute('aria-label')).toBe('Sourdough loaf');
      expect(row(fixture).getAttribute('aria-describedby')).toBe('cap-ln-1');
    });
  });

  describe('the state control is a picture', () => {
    it('is hidden from the accessibility tree', async () => {
      // The row already says the state. Announcing it here would say it twice.
      const fixture = await render(vm());
      const control = fixture.nativeElement.querySelector(
        'lib-line-state-control'
      ) as HTMLElement;

      expect(control.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('a write in flight', () => {
    it('is aria-busy and keeps its accessible name', async () => {
      const fixture = await render(vm({ write: 'pending' }));

      expect(row(fixture).getAttribute('aria-busy')).toBe('true');
      expect(row(fixture).getAttribute('aria-label')).toBe('Sourdough loaf');
    });

    it('is not busy when nothing is outstanding', async () => {
      const fixture = await render(vm());

      expect(row(fixture).getAttribute('aria-busy')).toBeNull();
    });

    it('offers a retry on the failed notice rather than a toast', async () => {
      const fixture = await render(vm({ write: 'failed' }));

      expect(
        fixture.nativeElement.querySelector('.notice.failed')
      ).not.toBeNull();
    });

    it('names whoever overwrote the row, or says somebody did', async () => {
      const named = await render(
        vm({ write: 'overwritten', overwrittenBy: 'Toni' })
      );
      expect(named.nativeElement.textContent).toContain(
        'list.line.overwritten'
      );

      const unnamed = await render(vm({ write: 'overwritten' }));
      expect(unnamed.nativeElement.textContent).toContain(
        'list.line.overwrittenBySomeone'
      );
    });
  });

  describe('reorder mode', () => {
    it('stops being a checkbox rather than keeping a role it dishonours', async () => {
      const fixture = await render(vm(), { reordering: true });

      expect(row(fixture).getAttribute('role')).toBeNull();
      expect(row(fixture).getAttribute('aria-checked')).toBeNull();
    });

    it('grows a focusable grip with real keys on it', async () => {
      // Not optional: a grip that only answered a pointer would put the manual order
      // out of reach of anybody without a working one.
      const fixture = await render(vm(), { reordering: true });
      const steps = fixture.nativeElement.querySelectorAll('.grip-step');

      expect(steps).toHaveLength(2);
      expect(
        (steps[0] as HTMLButtonElement).getAttribute('aria-label')
      ).toContain('list.reorder.moveUp');
    });

    it('emits a move rather than reordering its own siblings', async () => {
      const fixture = await render(vm(), { reordering: true });
      const emitted: string[] = [];
      fixture.componentInstance.act.subscribe((event) =>
        emitted.push(event.action)
      );

      (
        fixture.nativeElement.querySelectorAll(
          '.grip-step'
        )[1] as HTMLButtonElement
      ).click();

      expect(emitted).toEqual(['moveDown']);
    });

    it('does not tick anything off while the mode is on', async () => {
      const fixture = await render(vm(), { reordering: true });
      const emitted: string[] = [];
      fixture.componentInstance.ticked.subscribe((id) => emitted.push(id));

      row(fixture).click();

      expect(emitted).toEqual([]);
    });
  });

  describe('what the row offers', () => {
    it('ticks off on a tap', async () => {
      const fixture = await render(vm());
      const emitted: string[] = [];
      fixture.componentInstance.ticked.subscribe((id) => emitted.push(id));

      row(fixture).click();

      expect(emitted).toEqual(['ln-1']);
    });

    it('does nothing when the caller may not change it', async () => {
      const fixture = await render(vm({ interactive: false }));
      const emitted: string[] = [];
      fixture.componentInstance.ticked.subscribe((id) => emitted.push(id));

      row(fixture).click();

      expect(emitted).toEqual([]);
      expect(row(fixture).getAttribute('tabindex')).toBeNull();
    });

    it('draws no overflow at all when there is nothing in it', async () => {
      // Not a disabled one: a disabled control implies a permission that is merely
      // unavailable right now.
      const fixture = await render(vm({ actions: [] }));

      expect(fixture.nativeElement.querySelector('.trigger')).toBeNull();
    });

    it('gives a reader the comment affordance and nothing else', async () => {
      const fixture = await render(
        vm({ interactive: false, actions: ['comments'] })
      );

      const items = fixture.nativeElement.querySelectorAll('.item');
      expect(fixture.nativeElement.querySelector('.trigger')).not.toBeNull();
      expect(items).toHaveLength(0); // closed until opened
    });

    it('shows the two decisions only when the row is decidable', async () => {
      const staff = await render(
        vm({ approvalStatus: 'PENDING', decidable: true })
      );
      expect(staff.nativeElement.querySelectorAll('.decision')).toHaveLength(2);

      const plain = await render(vm({ approvalStatus: 'PENDING' }));
      expect(plain.nativeElement.querySelectorAll('.decision')).toHaveLength(0);
    });

    it('offers putting a turned down line back, to staff', async () => {
      const fixture = await render(
        vm({ approvalStatus: 'REJECTED', restorable: true, struck: true })
      );

      expect(fixture.nativeElement.textContent).toContain('list.line.restore');
    });
  });

  describe('the quantity', () => {
    it('is drawn only above one', async () => {
      const one = await render(vm({ quantity: 1 }));
      expect(one.nativeElement.querySelector('.quantity')).toBeNull();

      const many = await render(vm({ quantity: 6 }));
      expect(many.nativeElement.querySelector('.quantity')).not.toBeNull();
    });
  });

  describe('the comment count', () => {
    it('is absent at zero rather than drawn as a zero', async () => {
      const zero = await render(vm({ commentCount: 0 }));
      expect(zero.nativeElement.querySelector('.comment-count')).toBeNull();

      const none = await render(vm());
      expect(none.nativeElement.querySelector('.comment-count')).toBeNull();
    });

    it('is drawn when there is something to say', async () => {
      const fixture = await render(vm({ commentCount: 3 }));

      expect(
        fixture.nativeElement.querySelector('.comment-count')?.textContent
      ).toContain('3');
    });
  });
});
