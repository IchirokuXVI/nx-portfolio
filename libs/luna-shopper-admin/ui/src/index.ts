// Named, and not `export *`: this barrel offers what another project imports,
// and nothing else (admin plan 0047). A name used only inside this library is
// imported there by its relative path. `no-unused-public-export.spec.ts`
// in the app fails when a name here has no importer outside the library.
export { APP_AVAILABLE_LOCALES } from './lib/app-locales';
export {
  CATEGORY_TREE_ALL,
  CATEGORY_TREE_NONE,
  CategoryTree,
  type CategoryTreeNode,
} from './lib/catalog/category-tree';
export {
  ScopePicker,
  type ScopePickerChain,
  type ScopePickerChoice,
  type ScopePickerScope,
} from './lib/catalog/scope-picker';
export { BarChart } from './lib/chart/bar-chart';
export { type ChartSeries } from './lib/chart/chart-types';
export { LineChart } from './lib/chart/line-chart';
export { AppShell, type ShellLink } from './lib/chrome/app-shell';
export { NotFoundPage } from './lib/chrome/not-found-page';
export { ConfirmDialog } from './lib/confirm-dialog';
export { BlockNotice } from './lib/dashboard/block-notice';
export { type BarChartView, type TileView } from './lib/dashboard/tile-view';
export { EntryCard } from './lib/entry/entry-card';
export { keepTabInside } from './lib/focus-trap';
export { HarvestNotice } from './lib/harvest/harvest-notice';
export { QueueFrame, type QueueExtraView } from './lib/harvest/queue-frame';
export { RunProgressView } from './lib/harvest/run-progress';
export { RunRowView, type RunRow } from './lib/harvest/run-row';
export { CautionLine } from './lib/info/caution-line';
export { InfoButton } from './lib/info/info-button';
export { PAGE_HEADING_LEVEL, PageHeader } from './lib/page/page-header';
export { PAGE_FRAME_TABS, type PageTab } from './lib/page/page-tabs';
export { PopoverSheet } from './lib/page/popover-sheet';
export { ScopeMark } from './lib/page/scope-mark';
export { FieldRow, describedByOf } from './lib/record/field-row';
export { FieldValue } from './lib/record/field-value';
export { LockedValue } from './lib/record/locked-value';
export {
  RecordCollection,
  type CollectionLink,
  type RecordCollectionRow,
} from './lib/record/record-collection';
export { RecordSection } from './lib/record/record-section';
export { SaveBar } from './lib/record/save-bar';
export { FieldControl } from './lib/resource/field-control';
export { RecordId } from './lib/resource/record-id';
export {
  type ReferenceLookup,
  type ReferenceOption,
  type ReferenceScope,
} from './lib/resource/reference-lookup';
export { ReferencePicker } from './lib/resource/reference-picker';
export { ReferencesControl } from './lib/resource/references-control';
export { ResourceCellView } from './lib/resource/resource-cell';
export { ResourceFilters } from './lib/resource/resource-filters';
export { ResourceList, type RowAction } from './lib/resource/resource-list';
export { LUNA_SHOPPER_ADMIN_UI_TRANSLATIONS } from './lib/translations';
export { Viewport } from './lib/viewport';
