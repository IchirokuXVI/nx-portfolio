import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { PresenceRow } from './presence-row';

/**
 * Plan 0022, sections 3 and 5.
 *
 * The rules worth a test here are the ones that are quiet when they break: a row that
 * draws for nobody, a stack that shows more initials than it has room for, and a
 * compact row that puts a live region inside somebody's tap target.
 *
 * The testing translator returns the key rather than interpolating it, so the tests
 * assert on **which** key was chosen and on the structure around it. Whether the
 * Spanish for it reads well is not a thing a unit test can know.
 */
async function render(inputs: {
  names: readonly string[];
  messageKey?: string;
  countKey?: string;
  compact?: boolean;
}): Promise<ComponentFixture<PresenceRow>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [PresenceRow, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(PresenceRow);
  fixture.componentRef.setInput('names', inputs.names);
  fixture.componentRef.setInput(
    'messageKey',
    inputs.messageKey ?? 'home.presence.here'
  );
  fixture.componentRef.setInput('countKey', inputs.countKey ?? '');
  fixture.componentRef.setInput('compact', inputs.compact ?? false);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

function host(fixture: ComponentFixture<PresenceRow>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('PresenceRow', () => {
  describe('nobody is here', () => {
    // Never "0 online", never a greyed out placeholder. Presence under reports by
    // design, so a zero is the one number it must not assert, and this is also what
    // every surface shows the instant the socket drops.
    it('draws nothing at all', async () => {
      const fixture = await render({ names: [] });

      expect(host(fixture).querySelector('.text')).toBeNull();
      expect(host(fixture).querySelector('.avatars')).toBeNull();
    });

    // The host is the row, so it is the host that has to disappear: a parent places
    // this in a flex column with a gap, and a box left behind would leave the gap and
    // any separator the parent drew above it.
    it('takes the host box with it, so it costs no gap above it', async () => {
      const fixture = await render({ names: [] });

      expect(host(fixture).classList).toContain('empty');
    });
  });

  describe('somebody is here', () => {
    it('names them, with an initial each for the first two', async () => {
      const fixture = await render({ names: ['Ana', 'Marc', 'Ines'] });
      const initials = Array.from(
        host(fixture).querySelectorAll('.avatar')
      ).map((avatar) => avatar.textContent);

      expect(initials).toEqual(['A', 'M']);
      expect(host(fixture).textContent).toContain('home.presence.here');
    });

    // Slicing cuts a surrogate pair in half and a name starting with an emoji would
    // render the replacement character. Every initial in this app is a code point.
    it('takes an initial as a code point', async () => {
      const fixture = await render({ names: ['\u{1F600}na'] });

      expect(host(fixture).querySelector('.avatar')?.textContent).toBe(
        '\u{1F600}'
      );
    });

    // Presence changes with nobody touching the screen, so it is announced rather
    // than silently swapped.
    it('announces itself politely', async () => {
      const fixture = await render({ names: ['Ana'] });

      expect(
        host(fixture).querySelector('.text')?.getAttribute('aria-live')
      ).toBe('polite');
    });
  });

  describe('a crowd', () => {
    it('counts them once there are four, rather than listing four names', async () => {
      const many = await render({
        names: ['Ana', 'Marc', 'Ines', 'Toni'],
        countKey: 'home.presence.hereCount',
      });

      expect(many.nativeElement.textContent).toContain(
        'home.presence.hereCount'
      );
    });

    it('still names three of them', async () => {
      const few = await render({
        names: ['Ana', 'Marc', 'Ines'],
        countKey: 'home.presence.hereCount',
      });

      expect(few.nativeElement.textContent).toContain('home.presence.here');
      expect(few.nativeElement.textContent).not.toContain(
        'home.presence.hereCount'
      );
    });

    // The resume card never collapses, and no count key is how it says so.
    it('never collapses when it was given no count to collapse to', async () => {
      const fixture = await render({
        names: ['Ana', 'Marc', 'Ines', 'Toni', 'Sam'],
        messageKey: 'home.presence.here',
      });

      expect(fixture.nativeElement.textContent).toContain('home.presence.here');
    });
  });

  describe('a row inside a tap target', () => {
    // A region that rewrites itself inside a control keeps rewriting that control's
    // accessible name while somebody is reading it. The screen a compact row sits on
    // carries the announced sentence instead.
    it('is not a live region', async () => {
      const fixture = await render({ names: ['Ana'], compact: true });

      expect(
        host(fixture).querySelector('.text')?.getAttribute('aria-live')
      ).toBeNull();
    });

    // "Two avatars" is not a fact a screen reader can read off two letters, so the
    // sentence is taken off the screen rather than out of the page.
    it('keeps the sentence readable while taking it off the screen', async () => {
      const fixture = await render({
        names: ['Ana'],
        countKey: 'home.presence.hereCount',
        compact: true,
      });

      expect(host(fixture).querySelector('.off-screen')?.textContent).toContain(
        'home.presence.hereCount'
      );
    });

    // Four useful words in a control's name, where a list of names is a paragraph.
    //
    // Asserted as the whole rendered string rather than as the absence of the message
    // key, which is no longer a usable test: `home.presence.here` is a prefix of
    // `home.presence.hereCount`, so "does not contain the names key" is true of neither
    // branch and would pass whichever one ran.
    it('counts rather than names, even for one person', async () => {
      const fixture = await render({
        names: ['Ana'],
        countKey: 'home.presence.hereCount',
        compact: true,
      });

      expect(
        host(fixture).querySelector('.off-screen')?.textContent?.trim()
      ).toBe('home.presence.hereCount');
    });
  });
});
