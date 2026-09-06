#!/usr/bin/env node
/**
 * Validates one or more built documents against the schema the app itself
 * validates an upload with, loaded from the contracts library rather than copied
 * here, so a change to the contract fails this check instead of drifting past it.
 *
 *   node --experimental-strip-types \
 *     apps/luna-shopper-backend/harvester/tools/leaflet/validate.mjs <file.json> ...
 *
 * `--experimental-strip-types` is what lets Node import the contract's own `.ts`
 * file. Without it Node refuses the extension and the run reads as a missing
 * file rather than a missing flag.
 *
 * `--schema` exists for a checkout where the contract lives in a worktree rather
 * than in the tree this script sits in. It defaults to this tree.
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1'
);
/** tools/leaflet, tools, harvester, luna-shopper-backend, apps, then the root. */
const REPO = join(HERE, '..', '..', '..', '..', '..');
const DEFAULT_SCHEMA = join(
  REPO,
  'libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-1.schema.ts'
);

const args = process.argv.slice(2);
const schemaAt = args.indexOf('--schema');
const schemaPath = schemaAt >= 0 ? resolve(args[schemaAt + 1]) : DEFAULT_SCHEMA;
const files = args.filter(
  (arg, index) =>
    !arg.startsWith('--') &&
    !(schemaAt >= 0 && index === schemaAt + 1) &&
    arg.endsWith('.json')
);

if (files.length === 0) {
  console.error('usage: node validate.mjs [--schema <path>] <file.json> ...');
  process.exit(2);
}

const { harvestDocument1Schema } = await import('file://' + schemaPath);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(harvestDocument1Schema);

let bad = 0;
for (const file of files) {
  const document = JSON.parse(readFileSync(resolve(file), 'utf8'));
  if (validate(document)) {
    const priced = document.products.filter((product) => product.price).length;
    const unitOnly = document.products.filter(
      (product) => !product.price && product.unit_price
    ).length;
    console.log(
      `VALID   ${file}: ${document.products.length} products, ${priced} priced, ` +
        `${unitOnly} unit price only, ` +
        `${document.products.length - priced - unitOnly} neither, ` +
        `${(document.warnings ?? []).length} warnings`
    );
  } else {
    bad += 1;
    console.log(`INVALID ${file}: ${validate.errors.length} failures`);
    for (const error of validate.errors.slice(0, 40)) {
      console.log(
        '  ' +
          (error.instancePath || '/') +
          ' ' +
          error.message +
          (error.params?.missingProperty
            ? ` (${error.params.missingProperty})`
            : '')
      );
    }
  }
}

process.exit(bad === 0 ? 0 : 1);
