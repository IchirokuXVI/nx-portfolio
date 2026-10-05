import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  FieldDescriptor,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { FieldControl } from './field-control';
import { ReferencePicker } from './reference-picker';

/**
 * Whether a reference field of a form offers "None" (admin plan 0050,
 * section 2). The descriptor decides, and the picker is told and told nothing
 * else.
 */

function emptyOf(overrides: Partial<FieldDescriptor<ResourceRow>>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [FieldControl, RokuTranslatorTestingModule.forTesting()],
  });

  const fixture = TestBed.createComponent(FieldControl);
  fixture.componentRef.setInput('field', {
    kind: 'reference',
    name: 'productGroupId',
    label: 'field.group',
    resource: 'product-groups',
    ...overrides,
  });
  fixture.componentRef.setInput('value', '');
  fixture.componentRef.setInput('controlId', 'field-productGroupId');
  fixture.detectChanges();

  const picker: ReferencePicker = fixture.debugElement.query(
    By.directive(ReferencePicker)
  ).componentInstance;
  return picker.empty();
}

describe('a reference field of a form', () => {
  it('offers None where the column takes null', () => {
    expect(emptyOf({ nullable: true })).toBe('none');
  });

  /** The server refuses the row without it, so the list has no way to empty it. */
  it('offers no empty choice where it does not', () => {
    expect(emptyOf({})).toBeNull();
    expect(emptyOf({ required: true })).toBeNull();
  });

  it('lets the descriptor overrule the column, both ways', () => {
    expect(emptyOf({ nullable: true, emptyOption: false })).toBeNull();
    expect(emptyOf({ emptyOption: true })).toBe('none');
  });
});
