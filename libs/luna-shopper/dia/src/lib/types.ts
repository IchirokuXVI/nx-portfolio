/** One leaf of DIA's menu, with the root it sits under (plan 0174, section 1). */
export interface DiaLeaf {
  /** `L2108`. DIA reuses an id with a new meaning, so the name travels too. */
  id: string;
  /** The Spanish name as the menu prints it. */
  name: string;
  /** `/agua-y-refrescos/cola/c/L2108`: what a listing is asked for by. */
  path: string;
  rootId: string;
  rootName: string;
}

export interface DiaRoot {
  id: string;
  name: string;
  path: string;
  leaves: DiaLeaf[];
}

export interface DiaMenu {
  roots: DiaRoot[];
  /** Every leaf, in menu order. The "Todo" children are not leaves. */
  leaves: DiaLeaf[];
  /** `L150` Ofertas, which no walk reads (section 6.4). Null when absent. */
  offerCategoryId: string | null;
}

/** `prices` of a listing row, exactly as the API states it (section 4). */
export interface DiaRawPrices {
  currency: string;
  price: number;
  strikethroughPrice: number;
  /** Computed by DIA on `price`, so on a club row it is the club unit price. */
  pricePerUnit: number | null;
  /** `KILO`, `LITRO`, `UNIDAD`, `100 ML.`: verbatim, never converted. */
  measureUnit: string | null;
  isClubPrice: boolean;
  isPromoPrice: boolean;
  discountPercentage: number | null;
}

/** One entry of `promotions[]`. Text only: the site states no dates. */
export interface DiaPromotion {
  description: string | null;
  shortDescription: string | null;
  onlyClubDia: boolean;
}

export interface DiaListingRow {
  /** `sku_id`, a number as a string, sometimes with a letter suffix. */
  skuId: string;
  displayName: string;
  brand: string | null;
  /** `/agua-y-refrescos/cola/p/130617P4`: the product's own category path. */
  url: string | null;
  image: string | null;
  prices: DiaRawPrices | null;
  promotions: DiaPromotion[];
  unitsInStock: number;
  /** Present on rows sold by weight. */
  weightInGrams: number | null;
  averageWeight: number | null;
}

export interface DiaListingPage {
  rows: DiaListingRow[];
  pageNumber: number;
  totalPages: number;
  /** The count the leaf prints, which the report compares with rows read. */
  totalItems: number | null;
  /** `selected_category_id`, the leaf the server says it answered. */
  categoryId: string | null;
  /** `seo.current_category_name`, the leaf's name as the listing prints it. */
  categoryName: string | null;
  /**
   * The path the leaf moved to, when the first answer was a 301 that the client
   * followed once (section 6.4). Null for a leaf that has not moved.
   */
  movedTo: string | null;
}

/** One record of the shop file (section 5.1). The file has no postal code. */
export interface DiaStoreRecord {
  idTienda: string;
  /** Equals the detail's `tiendaCodigo` and a fulfilment store's key. */
  codigoTienda: string;
  /** 0 is DIA, 1 is Clarel. */
  tipoTienda: number;
  /** Two digits, zero padded: the first two of the shop's postal code. */
  provinceCode: string;
  latitude: number;
  longitude: number;
}

export interface DiaStoreFile {
  /** The DIA shops, `tipoTienda` 0. */
  stores: DiaStoreRecord[];
  /** Every record the file held. */
  total: number;
  /** Clarel records dropped, a perfumery banner with no leaflets. */
  clarelDropped: number;
  /** Records with no usable id or coordinates, named. */
  unreadable: string[];
}

/** One shop's detail (section 5.2). */
export interface DiaStoreDetail {
  /** `tiendaCodigo`, as a string. */
  storeCode: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  /** `horariosTienda` verbatim: keys `1` to `7`, Monday first. */
  hours: Record<string, string>;
  /** `festivosTienda` and `horariosAperturaFestivo`, verbatim JSON, or null. */
  holidays: string | null;
  /** `toolTipsPerecederos`, joined, or null. */
  fresh: string | null;
  homeDelivery: boolean;
  /** `folletoId`, `documentoFolletoId`, `validezFolleto2`, verbatim JSON. */
  leaflet: string | null;
  /** `fechaApertura` as an ISO date, or null. A future one is a closed shop. */
  reopensOn: string | null;
  closedFrom: string | null;
  closedUntil: string | null;
}

/** A shop the store discovery reports: a file record with its detail. */
export interface DiaStore extends DiaStoreRecord {
  detail: DiaStoreDetail;
}

export interface DiaClientOptions {
  /** Defaults to `https://www.dia.es`. */
  baseUrl?: string;
  /** Node's global `fetch` by default. Never `node:https` (section 2). */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Retries of a 429, a 5xx, a connection error or a timeout. Default 3. */
  retries?: number;
  /** The first backoff, doubled per retry. Default 30 s (section 10). */
  backoffBaseMs?: number;
  /** How long a 403 waits before its one retry. Default 60 s. */
  forbiddenRetryMs?: number;
  /**
   * The least time between two requests, held beside `acquire` and never
   * replaced by it. Default 500 ms, which is 2 requests per second whatever the
   * source row says (section 10).
   */
  minIntervalMs?: number;
  /** How long one request may take. Default 30 s. */
  timeoutMs?: number;
  /** Failed requests in a row that stop the client. Default 5 (section 10). */
  maxConsecutiveFailures?: number;
  /** The run's shared token bucket. One per run, never one per client. */
  acquire?: () => Promise<void>;
  signal?: AbortSignal;
  nowImpl?: () => number;
}
