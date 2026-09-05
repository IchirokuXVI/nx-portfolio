import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { FilterDescriptor } from '@portfolio/luna-shopper-admin/models';
import { ResourceFilters, type FilterChange } from './resource-filters';

/**
 * The two filter kinds plan 0007 needed and plan 0004 did not have.
 *
 * A **date**, because "created between" is a pair of timestamps at the gateway
 * and a day on the operator's calendar, and something has to convert one to the
 * other exactly once. A **reference**, because "zones belonging to this person"
 * is a question asked by name, and a filter demanding a pasted uuid is a filter
 * nobody uses.
 */

const AFTER: FilterDescriptor = {
  kind: 'date',
  param: 'createdAfter',
  label: 'filter.after',
  edge: 'start',
};

const BEFORE: FilterDescriptor = {
  kind: 'date',
  param: 'createdBefore',
  label: 'filter.before',
  edge: 'end',
};

const OWNER: FilterDescriptor = {
  kind: 'reference',
  param: 'userId',
  label: 'filter.owner',
  resource: 'users',
};

const GROUP: FilterDescriptor = {
  kind: 'reference',
  param: 'productGroupId',
  label: 'filter.group',
  resource: 'product-groups',
  nullable: true,
};

@Component({
  selector: 'lib-test-host',
  imports: [ResourceFilters],
  template: `
    <lib-resource-filters
      (filterChange)="changes.push($event)"
      [filters]="filters()"
      [lookup]="lookup"
      [values]="values()"
    />
  `,
})
class TestHost {
  readonly filters = signal<readonly FilterDescriptor[]>([]);
  readonly values = signal<Readonly<Record<string, string>>>({});
  readonly changes: FilterChange[] = [];
  readonly lookup = {
    search: async () => [{ id: 'u1', title: 'rosa' }],
    resolve: async () => ({ id: 'u1', title: 'rosa' }),
  };
}

function host(
  filters: readonly FilterDescriptor[],
  values: Readonly<Record<string, string>> = {}
): ComponentFixture<TestHost> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
  });

  const fixture = TestBed.createComponent(TestHost);
  fixture.componentInstance.filters.set(filters);
  fixture.componentInstance.values.set(values);
  fixture.detectChanges();

  return fixture;
}

function type(fixture: ComponentFixture<TestHost>, day: string) {
  const input: HTMLInputElement =
    fixture.nativeElement.querySelector('input[type="date"]');
  input.value = day;
  input.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

describe('a date filter', () => {
  /**
   * Local midnight rather than UTC. The operator picked a day on a calendar they
   * are looking at, and shifting it by their offset would silently move the
   * boundary by a day for anybody far enough east or west.
   */
  it('sends the start of the chosen day for a lower bound', () => {
    const fixture = host([AFTER]);

    type(fixture, '2026-03-04');

    const [change] = fixture.componentInstance.changes;
    expect(change.param).toBe('createdAfter');
    expect(new Date(change.value).getTime()).toBe(
      new Date(2026, 2, 4).getTime()
    );
  });

  /**
   * `createdBefore` is exclusive at the gateway, so an upper bound sends the
   * start of the following day. Picking the same day at both ends therefore
   * means that day, which is the only reading an operator has in mind.
   */
  it('sends the start of the next day for an upper bound', () => {
    const fixture = host([BEFORE]);

    type(fixture, '2026-03-04');

    const [change] = fixture.componentInstance.changes;
    expect(new Date(change.value).getTime()).toBe(
      new Date(2026, 2, 5).getTime()
    );
  });

  /** And shows back the day the operator chose, not the one it sent. */
  it('draws an upper bound as the day it stands for', () => {
    const fixture = host([BEFORE], {
      createdBefore: new Date(2026, 2, 5).toISOString(),
    });

    const input: HTMLInputElement =
      fixture.nativeElement.querySelector('input[type="date"]');
    expect(input.value).toBe('2026-03-04');
  });

  it('clears to nothing rather than to a date', () => {
    const fixture = host([AFTER], {
      createdAfter: new Date(2026, 2, 4).toISOString(),
    });

    type(fixture, '');

    expect(fixture.componentInstance.changes).toEqual([
      { param: 'createdAfter', value: '' },
    ]);
  });

  it('shows an empty control for a value it cannot read', () => {
    const fixture = host([AFTER], { createdAfter: 'not a date' });

    const input: HTMLInputElement =
      fixture.nativeElement.querySelector('input[type="date"]');
    expect(input.value).toBe('');
  });
});

describe('a reference filter', () => {
  it('draws the picker for the resource it points at', () => {
    const fixture = host([OWNER]);

    expect(
      fixture.nativeElement.querySelector('lib-reference-picker')
    ).not.toBeNull();
  });

  /**
   * A filter is always clearable, whatever the column it stands for allows.
   * "Every zone" is the resting state of this screen rather than a missing
   * value, so the picker offers a way back to it.
   */
  it('can always be emptied again', () => {
    const fixture = host([OWNER], { userId: 'u1' });

    const buttons = [...fixture.nativeElement.querySelectorAll('button')];
    const labels = buttons.map((button) =>
      (button as HTMLButtonElement).textContent?.trim()
    );

    expect(labels).toContain('resource.reference.clear');
  });

  /**
   * Plan 0012, section 2: the descriptor decides, per filter, whether "none" is
   * a question with an answer. The picker is told and told nothing else.
   */
  it('offers none only where the descriptor says the column may be empty', () => {
    const fixture = host([OWNER, GROUP]);
    const pickers = fixture.debugElement.queryAll(
      (node) => node.name === 'lib-reference-picker'
    );

    expect(pickers.map((picker) => picker.componentInstance.none())).toEqual([
      false,
      true,
    ]);
  });
});
