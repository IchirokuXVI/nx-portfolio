import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeProfileStore,
  profileFor,
  provideFakeProfileStore,
  provideFakeSessionStore,
  type FakeProfileStore,
} from '@portfolio/velista/data-access';
import { USERNAME_SCOPE_DEFAULT } from '@portfolio/velista/models';
import {
  PageNavigation,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { SetupFlow } from '../setup-flow';
import { fakeSetupFlow, type FakeSetupFlow } from '../testing/fake-setup-flow';
import { NameStep } from './name-step';

/**
 * Velista `0098`, section 5, step 1.
 *
 * The testing translator echoes keys and does not interpolate, so the button's words
 * are asserted by the key it shows, and the name is asserted where it is drawn
 * verbatim: on the card.
 */
async function render(): Promise<{
  fixture: ComponentFixture<NameStep>;
  profile: FakeProfileStore;
  flow: FakeSetupFlow;
}> {
  TestBed.resetTestingModule();

  const profile = fakeProfileStore({
    profile: profileFor({ username: 'Brave Anchor' }),
    suggestions: ['Quiet Harbour', 'Amber Fox'],
  });
  const flow = fakeSetupFlow();

  await TestBed.configureTestingModule({
    imports: [NameStep, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting(),
      provideFakeProfileStore(profile),
      provideFakeSessionStore('REGISTERED', { username: 'Brave Anchor' }),
      { provide: SetupFlow, useValue: flow },
      { provide: PageNavigation, useValue: { back: jest.fn() } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(NameStep);
  fixture.detectChanges();
  await settle(fixture);

  return { fixture, profile, flow };
}

async function settle(fixture: ComponentFixture<NameStep>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

function element<T extends HTMLElement>(
  fixture: ComponentFixture<NameStep>,
  selector: string
): T {
  const found = (fixture.nativeElement as HTMLElement).querySelector<T>(
    selector
  );
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
}

async function type(
  fixture: ComponentFixture<NameStep>,
  value: string
): Promise<void> {
  const field = element<HTMLInputElement>(fixture, '#setup-name');
  field.value = value;
  field.dispatchEvent(new Event('input'));
  await settle(fixture);
}

async function press(
  fixture: ComponentFixture<NameStep>,
  selector: string
): Promise<void> {
  element<HTMLButtonElement>(fixture, selector).click();
  await settle(fixture);
}

function renames(profile: FakeProfileStore) {
  return profile.calls.filter((call) => call.method === 'rename');
}

describe('NameStep', () => {
  it('starts with an empty field and the generated name on the card', async () => {
    const { fixture } = await render();

    expect(element<HTMLInputElement>(fixture, '#setup-name').value).toBe('');
    expect(element(fixture, '.picked-name').textContent?.trim()).toBe(
      'Brave Anchor'
    );
  });

  it('writes nothing for a blank field, and keeps the generated name', async () => {
    const { fixture, profile, flow } = await render();

    await press(fixture, '.primary');

    expect(renames(profile)).toHaveLength(0);
    expect(flow.go).toHaveBeenCalledWith('place');
  });

  it('writes a typed name once, and moves on', async () => {
    const { fixture, profile, flow } = await render();

    await type(fixture, '  Daniel ');
    await press(fixture, '.primary');

    expect(renames(profile)).toEqual([
      { method: 'rename', username: 'Daniel', scope: USERNAME_SCOPE_DEFAULT },
    ]);
    expect(flow.go).toHaveBeenCalledWith('place');
  });

  it('says what the button will do, following the field', async () => {
    const { fixture } = await render();
    const label = () => element(fixture, '.primary').textContent?.trim();

    expect(label()).toBe('setup.name.keep');

    await type(fixture, 'Daniel');
    expect(label()).toBe('setup.name.continue');

    await type(fixture, '   ');
    expect(label()).toBe('setup.name.keep');
  });

  it('swaps the name on the card for a suggestion, and writes nothing', async () => {
    const { fixture, profile } = await render();

    await press(fixture, '.another');

    expect(element(fixture, '.picked-name').textContent?.trim()).toBe(
      'Quiet Harbour'
    );
    expect(renames(profile)).toHaveLength(0);

    await press(fixture, '.another');
    expect(element(fixture, '.picked-name').textContent?.trim()).toBe(
      'Amber Fox'
    );
    expect(renames(profile)).toHaveLength(0);
  });

  it('writes the suggestion when the person keeps it', async () => {
    // The card's name is not the account's until the button says so.
    const { fixture, profile } = await render();

    await press(fixture, '.another');
    await press(fixture, '.primary');

    expect(renames(profile)).toEqual([
      {
        method: 'rename',
        username: 'Quiet Harbour',
        scope: USERNAME_SCOPE_DEFAULT,
      },
    ]);
  });

  it('writes nothing on Skip, whatever is typed', async () => {
    const { fixture, profile, flow } = await render();

    await type(fixture, 'Daniel');
    await press(fixture, '.skip');

    expect(renames(profile)).toHaveLength(0);
    expect(flow.go).toHaveBeenCalledWith('place');
  });

  describe('a name the server would refuse (velista 0160)', () => {
    it('draws the rule, marks the field and holds the button for an emoji', async () => {
      const { fixture, profile, flow } = await render();

      await type(fixture, 'Bruno 🍋 Peña');

      const field = element<HTMLInputElement>(fixture, '#setup-name');
      const rule = element(fixture, '#setup-name-rule');
      expect(rule.textContent?.trim()).toBe('account.error.nameCharacters');
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('aria-describedby')).toBe('setup-name-rule');

      const primary = element<HTMLButtonElement>(fixture, '.primary');
      expect(primary.disabled).toBe(true);
      // The refused name is not echoed as accepted, by the button or by the note.
      expect(primary.textContent?.trim()).toBe('setup.name.continuePlain');
      expect(fixture.nativeElement.querySelector('.note')).toBeNull();

      element<HTMLFormElement>(fixture, 'form').dispatchEvent(
        new Event('submit')
      );
      await settle(fixture);
      expect(renames(profile)).toHaveLength(0);
      expect(flow.go).not.toHaveBeenCalled();
    });

    it.each([
      ['a', 'account.error.nameLength'],
      ['123', 'account.error.nameLetter'],
      ['former member x', 'account.error.nameReserved'],
    ])('draws the rule %s breaks', async (value, key) => {
      const { fixture } = await render();

      await type(fixture, value);

      expect(element(fixture, '#setup-name-rule').textContent?.trim()).toBe(
        key
      );
      expect(element<HTMLButtonElement>(fixture, '.primary').disabled).toBe(
        true
      );
    });

    it('lets the field go back to normal once the name is fixed', async () => {
      const { fixture } = await render();

      await type(fixture, 'Bruno 🍋');
      await type(fixture, 'Bruno');

      const field = element<HTMLInputElement>(fixture, '#setup-name');
      expect(
        fixture.nativeElement.querySelector('#setup-name-rule')
      ).toBeNull();
      expect(field.getAttribute('aria-invalid')).toBeNull();
      expect(field.getAttribute('aria-describedby')).toBeNull();
      expect(element<HTMLButtonElement>(fixture, '.primary').disabled).toBe(
        false
      );
    });

    it('counts code points, so a letter outside the basic plane counts once', async () => {
      const { fixture } = await render();

      await type(fixture, '𝔄𝔄');

      expect(element(fixture, '.counter').textContent?.trim()).toBe('2 / 40');
    });
  });

  it('puts focus on the question when it arrives', async () => {
    const { fixture } = await render();

    expect(document.activeElement).toBe(element(fixture, 'h1'));
  });
});
