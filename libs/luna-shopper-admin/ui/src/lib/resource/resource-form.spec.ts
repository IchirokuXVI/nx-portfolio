import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  FieldDescriptor,
  FieldMessage,
  ResourceDraft,
} from '@portfolio/luna-shopper-admin/models';
import { ResourceForm } from './resource-form';

/**
 * The form, drawn from a descriptor (plan 0004, sections 5 and 8).
 *
 * Every assertion is on inputs and on the elements they produce, never on an
 * interpolated sentence: the testing translator returns keys and does not
 * interpolate, so a spec that read rendered text would be asserting the
 * translator's behaviour rather than the form's.
 */

const fields: FieldDescriptor[] = [
  { kind: 'text', name: 'id', label: 'shops.id', editable: false },
  {
    kind: 'localized-text',
    name: 'name',
    label: 'shops.name',
    locales: ['en', 'es'],
    required: true,
  },
  { kind: 'text', name: 'websiteUrl', label: 'shops.website', format: 'url' },
  { kind: 'boolean', name: 'active', label: 'shops.active' },
];

const draft: ResourceDraft = {
  name: { en: 'Bonpreu', es: 'Bonpreu' },
  websiteUrl: 'https://bonpreu.example',
  active: true,
};

async function render(
  inputs: Partial<{
    messages: Readonly<Record<string, readonly FieldMessage[]>>;
    strayErrors: readonly string[];
    busy: boolean;
    errorKey: string | null;
  }> = {}
): Promise<ComponentFixture<ResourceForm>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ResourceForm, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ResourceForm);
  fixture.componentRef.setInput('titleKey', 'resource.form.edit');
  fixture.componentRef.setInput('mode', 'edit');
  fixture.componentRef.setInput('fields', fields);
  fixture.componentRef.setInput('draft', draft);
  fixture.componentRef.setInput('readonlyCells', { id: { text: 'sm_1' } });

  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }

  fixture.detectChanges();
  return fixture;
}

const query = (fixture: ComponentFixture<ResourceForm>, selector: string) =>
  fixture.nativeElement.querySelectorAll(selector) as NodeListOf<HTMLElement>;

describe('ResourceForm', () => {
  it('draws a control for every editable field', async () => {
    const fixture = await render();

    // Two locale boxes for the name, one for the website, one checkbox.
    expect(query(fixture, 'input[type="text"]')).toHaveLength(3);
    expect(query(fixture, 'input[type="checkbox"]')).toHaveLength(1);
  });

  /**
   * An id and a created date are the two things an operator most often needs to
   * copy, so a form that hid everything it cannot change would be a worse
   * detail view than the table row it was opened from.
   */
  it('shows a field it cannot edit, as text rather than as a control', async () => {
    const fixture = await render();
    const readonly = query(fixture, '.readonly');

    expect(readonly).toHaveLength(1);
    expect(readonly[0].textContent).toContain('sm_1');
  });

  it('marks the required field and only that one', async () => {
    const fixture = await render();

    expect(query(fixture, '.required')).toHaveLength(1);
  });

  it('emits the field name and the new value together', async () => {
    const fixture = await render();
    const changes: { name: string; value: unknown }[] = [];
    fixture.componentInstance.valueChange.subscribe((change) =>
      changes.push({ name: change.name, value: change.value })
    );

    const website = query(fixture, 'input[type="text"]')[2] as HTMLInputElement;
    website.value = 'https://bonpreu.cat';
    website.dispatchEvent(new Event('input'));

    expect(changes).toEqual([
      { name: 'websiteUrl', value: 'https://bonpreu.cat' },
    ]);
  });

  /**
   * Section 5: a server's refusal goes back under the input that caused it,
   * rather than into a banner nobody can act on.
   */
  it('puts a message under the field it belongs to', async () => {
    const fixture = await render({
      messages: {
        websiteUrl: [{ kind: 'text', text: 'That domain is not reachable.' }],
      },
    });

    const errors = query(fixture, '.error');
    expect(errors).toHaveLength(1);
    expect(errors[0].textContent).toContain('That domain is not reachable.');

    // Under the website field, not at the top of the form.
    const fieldsWithErrors = [...query(fixture, '.field')].filter(
      (element) => element.querySelector('.error') !== null
    );
    expect(fieldsWithErrors).toHaveLength(1);
    expect(fieldsWithErrors[0].textContent).toContain('shops.website');
  });

  it('renders a keyed message through the translator and a server one verbatim', async () => {
    const fixture = await render({
      messages: {
        name: [{ kind: 'key', key: 'resource.error.required' }],
        websiteUrl: [{ kind: 'text', text: 'Refused by the server.' }],
      },
    });

    const errors = [...query(fixture, '.error')].map(
      (element) => element.textContent?.trim() ?? ''
    );
    expect(errors).toEqual([
      'resource.error.required',
      'Refused by the server.',
    ]);
  });

  /**
   * There is nowhere else for it, and dropping it would leave a refused submit
   * with no reason on screen at all.
   */
  it('puts a complaint about a field it does not have in the banner', async () => {
    const fixture = await render({
      strayErrors: ['operatingCompanyId must be a uuid'],
    });

    const banner = query(fixture, '.banner');
    expect(banner).toHaveLength(1);
    expect(banner[0].textContent).toContain(
      'operatingCompanyId must be a uuid'
    );
  });

  it('disables every control while submitting, so one submit cannot become three', async () => {
    const fixture = await render({ busy: true });

    const disabled = [
      ...query(fixture, 'input, button, select, textarea'),
    ].every((element) => (element as HTMLInputElement).disabled);
    expect(disabled).toBe(true);
  });

  it('asks to save rather than submitting the page', async () => {
    const fixture = await render();
    let saved = 0;
    fixture.componentInstance.save.subscribe(() => (saved += 1));

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));

    expect(saved).toBe(1);
  });
});

/**
 * What plan 0009 asks the form to say, and to draw.
 *
 * A sentence above the fields for a write the whole zone sees, help under a
 * field an operator cannot change, and a textarea for a settings blob. All three
 * are assertions about elements rather than about sentences, because the testing
 * translator returns keys and does not interpolate.
 */
describe('ResourceForm, on a resource plan 0009 made editable', () => {
  const zoneFields: FieldDescriptor[] = [
    {
      kind: 'text',
      name: 'name',
      label: 'people.zones.name',
      required: true,
    },
    {
      kind: 'json',
      name: 'config',
      label: 'people.zones.config',
      help: 'people.zones.configHelp',
    },
    {
      kind: 'text',
      name: 'joinCode',
      label: 'people.zones.joinCode',
      help: 'people.zones.joinCodeHelp',
      editable: false,
    },
  ];

  async function renderZone(
    noteKey: string | null
  ): Promise<ComponentFixture<ResourceForm>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ResourceForm, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(ResourceForm);
    fixture.componentRef.setInput('titleKey', 'resource.form.edit');
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('fields', zoneFields);
    fixture.componentRef.setInput('draft', {
      name: 'Kitchen',
      config: '{}',
    });
    fixture.componentRef.setInput('readonlyCells', {
      joinCode: { text: 'K4TCH2N9' },
    });
    fixture.componentRef.setInput('noteKey', noteKey);
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Plan 0009, section 7: the write broadcasts, so somebody with velista open
   * sees it arrive. Said once above the fields rather than as a confirmation on
   * every edit, which becomes a click people stop reading.
   */
  it('says above the fields what saving does beyond writing the row', async () => {
    const fixture = await renderZone('people.broadcast');
    const note = query(fixture, '.note');

    expect(note).toHaveLength(1);
    expect(note[0].textContent).toContain('people.broadcast');
  });

  it('says nothing where the resource named no note', async () => {
    const fixture = await renderZone(null);

    expect(query(fixture, '.note')).toHaveLength(0);
  });

  /**
   * Plan 0009, section 5. The form draws `help` outside the editable branch, so
   * a field an operator cannot change can still say what does change it. That is
   * what makes a missing control an answer rather than a gap.
   */
  it('draws the reason under a field it will not let an operator change', async () => {
    const fixture = await renderZone(null);
    const help = [...query(fixture, '.help')].map((node) => node.textContent);

    expect(help).toEqual([
      expect.stringContaining('people.zones.configHelp'),
      expect.stringContaining('people.zones.joinCodeHelp'),
    ]);
    // And the locked one really is locked: one control, for the name.
    expect(query(fixture, 'input[type="text"]')).toHaveLength(1);
  });

  /**
   * A settings blob is several lines before it is anything worth reading, so it
   * gets a textarea. The control holds text; the parse happens on the way out.
   */
  it('gives a json field a textarea', async () => {
    const fixture = await renderZone(null);
    const areas = query(fixture, 'textarea');

    expect(areas).toHaveLength(1);
    expect((areas[0] as HTMLTextAreaElement).value).toBe('{}');
  });
});
