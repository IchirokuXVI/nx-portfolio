import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { LineRowVm } from '@portfolio/velista/models';
import { LineRow } from './line-row';

/**
 * Velista plan 0043 section 7, which **replaces** `0012` section 7's row mapping in
 * full, plus the parts of the old one that survive unchanged.
 *
 * These are the rules a screenshot cannot check and a refactor is most likely to
 * quietly break. The largest of them is negative and is asserted as such: there is no
 * checkbox anywhere on this row any more, and nothing on it marks a line ready or not
 * available (section 1.1).
 */
function vm(overrides: Partial<LineRowVm> = {}): LineRowVm {
  return {
    id: 'ln-1',
    content: 'Sourdough loaf',
    quantity: 1,
    approvalStatus: 'APPROVED',
    settled: false,
    indicators: [],
    claimedBy: null,
    captionKey: null,
    write: 'none',
    overwrittenBy: null,
    interactive: true,
    adjustable: true,
    actions: ['edit', 'comments', 'delete'],
    // Non-null exactly when `actions` includes `edit`, which is the invariant
    // `LineRowVm.editScope` states and `select-list-state.spec.ts` guards.
    editScope: 'full',
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

function reel(fixture: ComponentFixture<LineRow>): HTMLElement | null {
  return fixture.nativeElement.querySelector('lib-quantity-reel');
}

describe('LineRow', () => {
  /**
   * Section 1.1, and the reason this plan is a rewrite of the row rather than an edit
   * to it. Asserted as an absence because that is what it is: every one of these
   * passing by accident would mean the checkbox had come back.
   */
  describe('what 0043 takes away', () => {
    it('is a button rather than a checkbox, with nothing checked about it', async () => {
      const fixture = await render(vm());

      expect(row(fixture).getAttribute('role')).toBe('button');
      expect(row(fixture).hasAttribute('aria-checked')).toBe(false);
    });

    it('has no control anywhere on it that marks a line not available', async () => {
      // Every action a row can carry, so this cannot pass by the fixture happening
      // not to include one.
      const fixture = await render(
        vm({ actions: ['edit', 'comments', 'delete', 'moveUp', 'moveDown'] })
      );

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('markNotAvailable');
      expect(text).not.toContain('markPending');
    });

    it('never strikes a settled line through, however quietly it is drawn', async () => {
      // The muting is a class the stylesheet reads; what matters here is that the
      // row does not claim the line is crossed out. A settled line is the record
      // that survives every trip (section 3.2).
      const fixture = await render(vm({ quantity: 0, settled: true }));

      expect(row(fixture).classList.contains('settled')).toBe(true);
      expect(row(fixture).classList.contains('struck')).toBe(false);
    });
  });

  describe('the accessible name', () => {
    it('is the content and the quantity, always', async () => {
      const fixture = await render(vm({ content: 'Milk', quantity: 1 }));

      // The number is in it even at one, where `0012` left it out. The quantity is
      // the line's state now rather than an annotation above one of them.
      expect(row(fixture).getAttribute('aria-label')).toBe('Milk, 1');
    });

    it('says zero rather than dropping it', async () => {
      const fixture = await render(vm({ content: 'Olive oil', quantity: 0 }));

      expect(row(fixture).getAttribute('aria-label')).toBe('Olive oil, 0');
    });

    it('does not grow the indicators or the caption into the name', async () => {
      const fixture = await render(
        vm({
          quantity: 0,
          settled: true,
          indicators: ['bought'],
          captionKey: 'list.line.awaitingApproval',
        })
      );

      expect(row(fixture).getAttribute('aria-label')).toBe(
        'Sourdough loaf, 0'
      );
      // Both are descriptions instead, which is where a screen reader user can reach
      // them on demand rather than having them read out on every focus (section 7).
      const describedBy = row(fixture).getAttribute('aria-describedby') ?? '';
      expect(describedBy.split(' ')).toEqual(['ind-ln-1', 'cap-ln-1']);
    });

    it('describes nothing when there is nothing to describe', async () => {
      const fixture = await render(vm());

      expect(row(fixture).hasAttribute('aria-describedby')).toBe(false);
    });
  });

  /** Section 3.3, and the one case that proves they are a list and not a value. */
  describe('the three indicators', () => {
    it('draws nothing at all on an ordinary row', async () => {
      const fixture = await render(vm());

      expect(fixture.nativeElement.querySelector('.indicators')).toBeNull();
    });

    it('draws nothing on a line at zero that has never been bought', async () => {
      // The never wanted case: somebody typed it and it has not been needed yet.
      // It looks exactly like a settled line to anything testing the quantity alone,
      // which is the whole reason the container is given a count to derive from.
      const fixture = await render(
        vm({ quantity: 0, settled: false, indicators: [] })
      );

      expect(fixture.nativeElement.querySelector('.indicators')).toBeNull();
    });

    it('draws two at once when two are true', async () => {
      const fixture = await render(
        vm({ indicators: ['notAvailable', 'claimed'], claimedBy: 'Ana' })
      );

      const drawn = [
        ...fixture.nativeElement.querySelectorAll('.indicator'),
      ] as HTMLElement[];
      expect(drawn).toHaveLength(2);
      expect(drawn[0].classList.contains('indicator-notAvailable')).toBe(true);
      expect(drawn[1].classList.contains('indicator-claimed')).toBe(true);
    });

    it('names whoever is buying it, and says somebody when it cannot', async () => {
      const named = await render(
        vm({ indicators: ['claimed'], claimedBy: 'Ana' })
      );
      expect(
        named.nativeElement.querySelector('.indicator-claimed')?.textContent
      ).toContain('claimedBy');

      const anonymous = await render(
        vm({ indicators: ['claimed'], claimedBy: null })
      );
      expect(
        anonymous.nativeElement.querySelector('.indicator-claimed')?.textContent
      ).toContain('claimed');
    });
  });

  describe('the quantity', () => {
    it('is drawn on every row, zero included', async () => {
      // `0012` drew it only above one, because it was an annotation. It is the
      // control now, and a control that is only sometimes there is not one anybody
      // learns to reach for.
      const one = await render(vm({ quantity: 1 }));
      const zero = await render(vm({ quantity: 0 }));

      expect(reel(one)).not.toBeNull();
      expect(reel(zero)).not.toBeNull();
    });

    it('is read only for a caller who may not decide', async () => {
      const fixture = await render(vm({ adjustable: false }));

      expect(reel(fixture)?.getAttribute('aria-readonly')).toBe('true');
    });

    it('is a spinbutton naming the line, with a floor of zero', async () => {
      const fixture = await render(vm({ quantity: 3 }));

      expect(reel(fixture)?.getAttribute('role')).toBe('spinbutton');
      expect(reel(fixture)?.getAttribute('aria-valuenow')).toBe('3');
      expect(reel(fixture)?.getAttribute('aria-valuemin')).toBe('0');
    });

    it('goes away in reorder mode', async () => {
      // A second gesture living inside a row being dragged would fight the first for
      // the same finger.
      const fixture = await render(vm(), { reordering: true });

      expect(reel(fixture)).toBeNull();
    });
  });

  describe('what a tap does', () => {
    it('opens the line rather than ticking it off', async () => {
      const fixture = await render(vm());
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      row(fixture).click();

      expect(opened).toEqual(['ln-1']);
    });

    it('opens on Enter and on Space', async () => {
      for (const key of ['Enter', ' ']) {
        const fixture = await render(vm());
        const opened: string[] = [];
        fixture.componentInstance.opened.subscribe((id) => opened.push(id));

        row(fixture).dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true })
        );

        expect(opened).toEqual(['ln-1']);
      }
    });

    it('does nothing at all in reorder mode', async () => {
      const fixture = await render(vm(), { reordering: true });
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      row(fixture).click();

      expect(opened).toEqual([]);
      expect(row(fixture).hasAttribute('role')).toBe(false);
    });

    it('does nothing for a row that cannot be opened', async () => {
      const fixture = await render(vm({ interactive: false }));
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      row(fixture).click();

      expect(opened).toEqual([]);
    });
  });

  describe('somebody else editing', () => {
    it('draws their initial and the word, and nothing when nobody is', async () => {
      const editing = await render(vm({ editor: 'Ana' }));
      expect(
        editing.nativeElement.querySelector('.editor-avatar')?.textContent
      ).toBe('A');

      const alone = await render(vm());
      expect(alone.nativeElement.querySelector('.editor')).toBeNull();
    });

    it('takes the initial as a code point', async () => {
      // Slicing a string cuts a surrogate pair in half and renders the replacement
      // character for a name that starts with an emoji.
      const fixture = await render(vm({ editor: '🌞 Ana' }));

      expect(
        fixture.nativeElement.querySelector('.editor-avatar')?.textContent
      ).toBe('🌞');
    });

    it('leaves the row a tappable button', async () => {
      // Advisory and nothing more (plan 0022, section 3.4). It is not a lock, and the
      // one thing it must never become is a guard.
      const fixture = await render(vm({ editor: 'Ana' }));
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      row(fixture).click();

      expect(opened).toEqual(['ln-1']);
    });

    it('stays out of the accessible name of the row', async () => {
      const fixture = await render(vm({ editor: 'Ana' }));

      expect(row(fixture).getAttribute('aria-label')).toBe(
        'Sourdough loaf, 1'
      );
    });
  });

  describe('a write in flight', () => {
    it('is aria-busy and keeps its accessible name', async () => {
      const fixture = await render(vm({ write: 'pending' }));

      expect(row(fixture).getAttribute('aria-busy')).toBe('true');
      expect(row(fixture).getAttribute('aria-label')).toBe(
        'Sourdough loaf, 1'
      );
    });

    it('is not busy when nothing is outstanding', async () => {
      const fixture = await render(vm());

      expect(row(fixture).hasAttribute('aria-busy')).toBe(false);
    });

    it('offers a retry on the failed notice rather than a toast', async () => {
      const fixture = await render(vm({ write: 'failed' }));
      const retried: string[] = [];
      fixture.componentInstance.retry.subscribe((id) => retried.push(id));

      (
        fixture.nativeElement.querySelector('.notice.failed') as HTMLElement
      ).click();

      expect(retried).toEqual(['ln-1']);
    });

    it('names whoever overwrote the row, or says somebody did', async () => {
      const named = await render(
        vm({ write: 'overwritten', overwrittenBy: 'Marc' })
      );
      expect(
        named.nativeElement.querySelector('.notice.overwritten')?.textContent
      ).toContain('overwritten');

      const anonymous = await render(
        vm({ write: 'overwritten', overwrittenBy: null })
      );
      expect(
        anonymous.nativeElement.querySelector('.notice.overwritten')?.textContent
      ).toContain('overwrittenBySomeone');
    });
  });

  describe('reorder mode', () => {
    it('drops the role rather than keeping one it dishonours', async () => {
      const fixture = await render(vm(), { reordering: true });

      expect(row(fixture).hasAttribute('role')).toBe(false);
      expect(row(fixture).hasAttribute('aria-label')).toBe(false);
    });

    it('grows a focusable grip with real keys on it', async () => {
      const fixture = await render(vm(), { reordering: true });

      const steps = fixture.nativeElement.querySelectorAll('.grip-step');
      expect(steps).toHaveLength(2);
    });

    it('emits a move rather than reordering its own siblings', async () => {
      const fixture = await render(vm(), { reordering: true });
      const acted: string[] = [];
      fixture.componentInstance.act.subscribe((e) => acted.push(e.action));

      const steps = [
        ...fixture.nativeElement.querySelectorAll('.grip-step'),
      ] as HTMLElement[];
      steps[0].click();
      steps[1].click();

      expect(acted).toEqual(['moveUp', 'moveDown']);
    });
  });

  describe('what the row offers', () => {
    it('draws no overflow at all when there is nothing in it', async () => {
      // An absent menu rather than a disabled one: a disabled control implies a
      // permission that is merely unavailable right now.
      const fixture = await render(vm({ actions: [], editScope: null }));

      expect(fixture.nativeElement.querySelector('.trigger')).toBeNull();
    });

    it('gives a reader the comment affordance and nothing else', async () => {
      const fixture = await render(
        vm({ actions: ['comments'], editScope: null })
      );
      (fixture.nativeElement.querySelector('.trigger') as HTMLElement).click();
      fixture.detectChanges();

      const items = [
        ...fixture.nativeElement.querySelectorAll('.item'),
      ] as HTMLElement[];
      expect(items.map((item) => item.textContent?.trim())).toEqual([
        'list.line.comments',
      ]);
    });

    it('shows the two decisions only when the row is decidable', async () => {
      const undecided = await render(vm());
      expect(undecided.nativeElement.querySelector('.decisions')).toBeNull();

      const waiting = await render(
        vm({ approvalStatus: 'PENDING', decidable: true })
      );
      expect(
        waiting.nativeElement.querySelectorAll('.decision')
      ).toHaveLength(2);
    });

    it('offers putting a turned down line back, to whoever decides', async () => {
      const fixture = await render(
        vm({ approvalStatus: 'REJECTED', restorable: true })
      );

      expect(
        fixture.nativeElement.querySelector('.decision')?.textContent
      ).toContain('restore');
    });
  });

  describe('the comment count', () => {
    it('is absent at zero rather than drawn as a zero', async () => {
      const unknown = await render(vm());
      expect(unknown.nativeElement.querySelector('.comment-count')).toBeNull();

      const none = await render(vm({ commentCount: 0 }));
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
