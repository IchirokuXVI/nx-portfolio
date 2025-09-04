import deepEqual from 'deep-equal';
import { findField } from '../functions/findField';
import { RecursivePaths } from '../types/recursive-paths';
import { WithRequired } from '../types/with-required';
import { multiSort } from '../functions/multisort';

interface FilterConfig<DataType, FilterType> {
  check: CheckFunction<DataType, FilterType>,
  dataField?: RecursivePaths<DataType> | RecursivePaths<DataType>[],
}

interface FormattedFilterConfig<DataType, FilterType> {
  check: CheckFunction<DataType, FilterType>,
  dataField: RecursivePaths<DataType>[],
}

type CheckFunction<DataType, FilterType> = (
  itemValue: DataType,
  filterValue: FilterType[keyof FilterType],
  filterConfig: WithRequired<FormattedFilterConfig<DataType, FilterType>, 'dataField'>
) => boolean

export class InMemoryFilter<DataType, FilterType> {
  private _filterConfig?: { [key in keyof FilterType]: FilterConfig<DataType, FilterType> };

  readonly checks = {
    equals: (itemValue, filterValue, filterConfig) => filterConfig.dataField.every((dataField) => findField(itemValue, dataField) == filterValue),
    strictEquals: (itemValue, filterValue, filterConfig) => filterConfig.dataField.every((dataField) => findField(itemValue, dataField) === filterValue),
    valueIncludes: (itemValue, filterValue, filterConfig) => filterConfig.dataField.every((dataField) => {
      const ogFieldValue = findField(itemValue, dataField);

      const fieldValue = Array.isArray(ogFieldValue) ? ogFieldValue : [ogFieldValue];

      return fieldValue.includes(filterValue);
    }),
    filterIncludes: (itemValue, filterValue, filterConfig) => filterConfig.dataField.every((dataField) => {
      const itemFieldValue = findField(itemValue, dataField);

      return (Array.isArray(filterValue) ? filterValue : [filterValue]).every((filterVal) => filterVal.includes(itemFieldValue));
    }),
    filterIncludesAny: (itemValue, filterValue, filterConfig) => filterConfig.dataField.every((dataField) => {
      const itemFieldValue = findField(itemValue, dataField);

      return (Array.isArray(filterValue) ? filterValue : [filterValue]).some((filterVal) => filterVal.includes(itemFieldValue));
    }),
    deepEquals: (itemValue, filterValue, filterConfig) => filterConfig.dataField.every((dataField) => deepEqual(findField(itemValue, dataField), filterValue, { strict: true })),
    textSearch: (itemValue, filterValue, filterConfig) => filterConfig.dataField.every((dataField) => (findField(itemValue, dataField) as string).match((filterValue as RegExp))),
  } satisfies Record<
    string,
    CheckFunction<DataType, FilterType>
  >;

  constructor() { }

  setFilterConfig(filterConfig: { [key in keyof FilterType]: FilterConfig<DataType, FilterType> }) {
    this._filterConfig = filterConfig;
  }

  applyFilter(items: DataType[], filter?: FilterType, options?: { sort?: string, limit?: number }): DataType[] {
    if (!filter || Object.keys(filter).length === 0) return items;

    const filteredItems = items.filter(item => {
      for (const key of Object.keys(filter) as (keyof FilterType)[]) {
        const filterConfig = this._filterConfig?.[key];

        if (!filterConfig) {
          throw new Error(`Filter config for key ${String(key)} not found`);
        }

        const filterValue = filter[key];

        const dataField = (Array.isArray(filterConfig.dataField) && filterConfig.dataField.length ? filterConfig.dataField : [filterConfig.dataField || key]) as RecursivePaths<DataType>[];

        if (!dataField) throw new Error(`dataField wasn't found for filter config ${String(key)}`);

        if (!filterConfig.check(item, filterValue, { ...filterConfig, dataField })) {
          return false;
        }
      }

      return true;
    });

    const sortedItems = options?.sort ? filteredItems.sort(multiSort<DataType>(options.sort)) : filteredItems;

    return options?.limit ? sortedItems.slice(0, options.limit) : sortedItems;
  }
}


