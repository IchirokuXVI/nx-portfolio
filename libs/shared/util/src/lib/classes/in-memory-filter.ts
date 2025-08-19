import deepEqual from 'deep-equal';
import { findField } from '../functions/findField';
import { RecursivePaths } from '../types/recursive-paths';

interface FilterConfig<DataType, FilterType> {
  check: CheckFunction<DataType, FilterType>,
  dataField?: RecursivePaths<DataType>,
}

type CheckFunction<DataType, FilterType> = (
  itemValue: DataType,
  filterValue: FilterType[keyof FilterType],
  filterConfig: Required<Pick<FilterConfig<DataType, FilterType>, 'dataField'>>
) => boolean

export class InMemoryFilter<DataType, FilterType> {
  private _filterConfig?: { [key in keyof FilterType]: FilterConfig<DataType, FilterType> };

  readonly checks = {
    equals: (itemValue, filterValue, filterConfig) => findField(itemValue, filterConfig.dataField) == filterValue,
    strictEquals: (itemValue, filterValue, filterConfig) => findField(itemValue, filterConfig.dataField) === filterValue,
    valueIncludes: (itemValue, filterValue, filterConfig) => findField(itemValue, filterConfig.dataField).includes(filterValue),
    filterIncludes: (itemValue, filterValue, filterConfig) => (filterValue as any).includes(findField(itemValue, filterConfig.dataField)),
    deepEquals: (itemValue, filterValue, filterConfig) => deepEqual(findField(itemValue, filterConfig.dataField), filterValue, { strict: true }),
  } satisfies Record<
    string,
    CheckFunction<DataType, FilterType>
  >;

  constructor() { }

  setFilterConfig(filterConfig: { [key in keyof FilterType]: FilterConfig<DataType, FilterType> }) {
    this._filterConfig = filterConfig;
  }

  applyFilter(items: DataType[], filter?: FilterType): DataType[] {
    if (!filter || Object.keys(filter).length === 0) return items;

    return items.filter(item => {
      for (const key of Object.keys(filter) as (keyof FilterType)[]) {
        const filterConfig = this._filterConfig?.[key];

        if (!filterConfig) {
          throw new Error(`Filter config for key ${String(key)} not found`);
        }

        const filterValue = filter[key];

        const dataField = filterConfig.dataField || key;

        if (!dataField) throw new Error(`dataField wasn't found for filter config ${String(key)}`);

        if (!filterConfig.check(item, filterValue, { ...filterConfig, dataField })) {
          return false;
        }
      }

      return true;
    });
  }
}


