// The chains the finder knows. One module per chain, each exporting a `chain`
// with a `key`, a `name` and a `findLeaflets(http, options)` that answers every
// leaflet the chain publishes right now, in the shape `find-leaflets.mjs`
// documents. Add a chain by adding a module and a line here.

import { chain as lidl } from './lidl.mjs';

export const CHAINS = [lidl];
