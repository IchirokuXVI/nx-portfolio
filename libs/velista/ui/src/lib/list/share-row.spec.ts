import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { ListPermission, ShareRowVm } from '@portfolio/velista/models';
import { ShareRow } from './share-row';

/**
 * Plan 0030, sections 6.1 to 6.3, and acceptance items 8 and 9.
 *
 * Four of the five claims here are about a checkbox that is drawn and cannot be moved,
 * which is the opposite of what a row menu does with an unavailable action, so they are
 * asserted against the DOM rather than against a view model: the whole point is that the
 * control exists and refuses, and a component that quietly omitted it would satisfy any
 * test written against inputs alone.
 */
function member(overrides: Partial<ShareRowVm> = {}): ShareRowVm {
  return {
    membershipId: 'm-1',
    username: 'Marc',
    permissions: ['READ'],
    lockedPermissions: [],
    fixed: false,
    fixedReasonKey: null,
    summary: ['READ'],
    edited: false,
    ...overrides,
  };
}

async function render(
  vm: ShareRowVm,
  creator = false
): Promise<ComponentFixture<ShareRow>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ShareRow, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShareRow);
  fixture.componentRef.setInput('member', vm);
  fixture.componentRef.setInput('creator', creator);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

/** The four boxes, in the order the row draws them: read, write, decide, manage. */
function boxes(fixture: ComponentFixture<ShareRow>): HTMLInputElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.checkbox')
  );
}

/** The disclosure header, which is the whole row when the row is closed. */
function header(fixture: ComponentFixture<ShareRow>): HTMLButtonElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '.header'
  ) as HTMLButtonElement;
}

/** The region the header controls. Always in the DOM; `hidden` is what closes it. */
function region(fixture: ComponentFixture<ShareRow>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '.boxes'
  ) as HTMLElement;
}

/** The last set the row emitted, or null when it emitted nothing. */
function emitted(fixture: ComponentFixture<ShareRow>): {
  sets: readonly (readonly ListPermission[])[];
} {
  const sets: (readonly ListPermission[])[] = [];
  fixture.componentInstance.changed.subscribe((change) =>
    sets.push(change.permissions)
  );
  return { sets };
}

describe('ShareRow as a disclosure (plan 0036, section 6)', () => {
  it('is closed on first render', async () => {
    // Twelve members is forty eight checkboxes and no summary, and the question people
    // open this sheet with has to be answerable without reading all of them.
    const fixture = await render(member());

    expect(header(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(region(fixture).hidden).toBe(true);
  });

  it('opens and closes from the header, which names the region it controls', async () => {
    const fixture = await render(member());

    expect(header(fixture).getAttribute('aria-controls')).toBe(
      region(fixture).id
    );

    header(fixture).click();
    fixture.detectChanges();
    expect(header(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(region(fixture).hidden).toBe(false);

    header(fixture).click();
    fixture.detectChanges();
    expect(header(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(region(fixture).hidden).toBe(true);
  });

  it('keeps an edit across a collapse and reopen', async () => {
    // The edit lives in the sheet, not in the row: the row holds only whether it is
    // open, so closing it can never discard anything.
    const fixture = await render(member({ permissions: ['READ'] }));
    const { sets } = emitted(fixture);

    header(fixture).click();
    fixture.detectChanges();
    boxes(fixture)[1].click();
    expect(sets.at(-1)).toEqual(['READ', 'WRITE']);

    // The sheet is what would feed the new set back in; here the input is unchanged,
    // and what is asserted is that closing and reopening emitted nothing of its own.
    header(fixture).click();
    fixture.detectChanges();
    header(fixture).click();
    fixture.detectChanges();

    expect(sets).toHaveLength(1);
    expect(boxes(fixture)).toHaveLength(4);
  });

  it('draws the summary, and no access as words rather than as a badge', async () => {
    const held = await render(member({ summary: ['WRITE', 'DECIDE'] }));
    expect(
      Array.from(
        (held.nativeElement as HTMLElement).querySelectorAll('.badge')
      ).map((badge) => badge.textContent?.trim())
    ).toEqual([
      'list.settings.access.summary.write',
      'list.settings.access.summary.decide',
    ]);

    const none = await render(member({ permissions: [], summary: [] }));
    expect(
      (none.nativeElement as HTMLElement).querySelector('.badge.none')
    ).not.toBeNull();
  });

  it('marks an edited row in the header', async () => {
    const fixture = await render(member({ edited: true }));

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.edited')
    ).not.toBeNull();
  });
});

describe('ShareRow', () => {
  it('draws all four permissions, always', async () => {
    // Including the one that is not always live. Hiding it in some rows and not others
    // would make the table itself unreadable (section 6.1).
    expect(boxes(await render(member()))).toHaveLength(4);
  });

  it('ticks the boxes the member actually holds', async () => {
    const fixture = await render(member({ permissions: ['READ', 'DECIDE'] }));

    expect(boxes(fixture).map((box) => box.checked)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  describe('ticking anything ticks read (section 6.2)', () => {
    it('adds READ the moment another box goes on', async () => {
      // The server does this to any non-empty set it is given. Doing it here as well
      // duplicates the feedback and not the rule: the server enforces, and the sheet
      // explains before the save instead of after it.
      const fixture = await render(member({ permissions: [] }));
      const seen = emitted(fixture);

      boxes(fixture)[1].checked = true;
      boxes(fixture)[1].dispatchEvent(new Event('change'));

      expect(seen.sets.at(-1)).toEqual(['READ', 'WRITE']);
    });

    it('leaves READ ticked when the last of the others goes off', async () => {
      const fixture = await render(member({ permissions: ['READ', 'WRITE'] }));
      const seen = emitted(fixture);

      boxes(fixture)[1].checked = false;
      boxes(fixture)[1].dispatchEvent(new Event('change'));

      expect(seen.sets.at(-1)).toEqual(['READ']);
    });

    it('clears the row when READ itself goes off', async () => {
      // The only thing "cannot view" can mean, and an empty set is how the same call
      // revokes access (backend plan 0036, section 5, rule 5).
      const fixture = await render(
        member({ permissions: ['READ', 'WRITE', 'DECIDE'] })
      );
      const seen = emitted(fixture);

      boxes(fixture)[0].checked = false;
      boxes(fixture)[0].dispatchEvent(new Event('change'));

      expect(seen.sets.at(-1)).toEqual([]);
    });
  });

  describe('locked and fixed', () => {
    it('draws a locked box in its current state, disabled, with the reason', async () => {
      // Acceptance item 9, opened by a list admin who is not group staff.
      const fixture = await render(
        member({
          permissions: ['READ', 'WRITE', 'MANAGE'],
          lockedPermissions: ['MANAGE'],
          fixedReasonKey: 'list.settings.access.manageLocked',
        })
      );

      const manage = boxes(fixture)[3];
      expect(manage.checked).toBe(true);
      expect(manage.disabled).toBe(true);
      expect(fixture.nativeElement.textContent).toContain(
        'list.settings.access.manageLocked'
      );
    });

    it('leaves the other three on that row live', async () => {
      const fixture = await render(
        member({
          permissions: ['READ'],
          lockedPermissions: ['MANAGE'],
          fixedReasonKey: 'list.settings.access.manageLocked',
        })
      );

      expect(boxes(fixture).map((box) => box.disabled)).toEqual([
        false,
        false,
        false,
        true,
      ]);
    });

    it('emits nothing for a locked box, whatever reaches the handler', async () => {
      const fixture = await render(
        member({ permissions: ['READ'], lockedPermissions: ['MANAGE'] })
      );
      const seen = emitted(fixture);

      fixture.componentInstance.toggle('MANAGE', {
        target: { checked: true },
      } as unknown as Event);

      expect(seen.sets).toHaveLength(0);
    });

    it('draws a group admin fully ticked and unchangeable, with the note', async () => {
      // Acceptance item 8. Shown and fixed rather than hidden: a hidden row invites the
      // question "why can Marc still edit this?" and this sheet is the only answer.
      const fixture = await render(
        member({
          permissions: [],
          lockedPermissions: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
          fixed: true,
          fixedReasonKey: 'list.settings.access.staffNote',
        })
      );

      expect(boxes(fixture).map((box) => box.checked)).toEqual([
        true,
        true,
        true,
        true,
      ]);
      expect(boxes(fixture).every((box) => box.disabled)).toBe(true);
      expect(fixture.nativeElement.textContent).toContain(
        'list.settings.access.staffNote'
      );
    });
  });

  describe('the creator', () => {
    it('gets a label beside their name and an ordinary set of boxes', async () => {
      // Their power is a stored access row now (backend plan 0036, section 2.5), so a
      // group admin can rewrite it. What they keep is the label (section 6.3).
      const fixture = await render(member({ permissions: ['READ'] }), true);

      expect(fixture.nativeElement.textContent).toContain(
        'list.settings.access.creator'
      );
      expect(boxes(fixture).every((box) => box.disabled)).toBe(false);
    });

    it('says nothing about anybody else', async () => {
      const fixture = await render(member());

      expect(fixture.nativeElement.textContent).not.toContain(
        'list.settings.access.creator'
      );
    });
  });
});
