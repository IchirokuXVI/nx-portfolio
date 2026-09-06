// Turns the gateway's committed OpenAPI document into TypeScript types the admin
// app uses as its view models (admin plan 0004, section 2).
//
//   node tools/openapi/generate-wire-types.mjs           # write the file
//   node tools/openapi/generate-wire-types.mjs --check   # fail if it is stale
//
// Written by hand rather than pulled from npm, and that is a deliberate trade.
// The document is one gateway's, produced by one generator, and the subset of
// JSON Schema it uses is small and known. A dependency would carry every shape
// this document does not contain, and this workspace already hand rolls its
// tooling (`tools/docker`, `tools/release`) for the same reason.
//
// It reads `components.schemas` and nothing else. The paths describe which URL
// answers with which schema, which is a fact the caller states anyway when it
// writes the request, so generating a second description of it would produce
// types nobody injects.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(here, '..', '..');

export const DOCUMENT_PATH = join(
  'apps',
  'luna-shopper-backend',
  'gateway',
  'docs',
  'openapi.json'
);

export const OUTPUT_PATH = join(
  'libs',
  'luna-shopper-admin',
  'models',
  'src',
  'lib',
  'wire',
  'wire-types.ts'
);

const BANNER = `// Generated from ${DOCUMENT_PATH.split('\\').join('/')}. Do not edit.
//
// Regenerate with \`npx nx run luna-shopper-admin/models:wire-types\`, and commit
// the result. \`wire-types.spec.ts\` fails when this file no longer matches the
// document, so a gateway change that is not regenerated is a red test rather
// than silent drift.
//
// Why these are the view models rather than a hand written mapping, and why that
// does not contradict rule D4, is admin plan 0004, section 2.
`;

/**
 * A schema name as a TypeScript identifier.
 *
 * `catalog.SupermarketView` becomes `CatalogSupermarketView`. The dotted prefix
 * is the contract library's namespace and carries real meaning, so it is kept
 * rather than dropped: `catalog.ItemView` and `harvest.ItemView` are different
 * shapes and flattening both to `ItemView` would make one of them unreachable.
 */
export function identifierFor(name) {
  const identifier = name
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  assert.match(
    identifier,
    /^[A-Za-z][A-Za-z0-9]*$/,
    `schema name ${name} does not produce a usable identifier`
  );

  return identifier;
}

/** A property name, quoted only when it has to be. */
function propertyKey(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? name
    : `'${name.split('\\').join('\\\\').split("'").join("\\'")}'`;
}

/** A JSON value as a TypeScript literal type. */
function literal(value) {
  if (typeof value === 'string') {
    return `'${value.split('\\').join('\\\\').split("'").join("\\'")}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return 'null';
}

const PRIMITIVES = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  null: 'null',
};

/**
 * One schema as a TypeScript type expression.
 *
 * `indent` is the indentation of the line the expression starts on, so a nested
 * object literal closes its brace under the property that opened it.
 */
function typeFor(schema, names, indent) {
  if (schema === undefined || schema === null || typeof schema !== 'object') {
    return 'unknown';
  }

  if (typeof schema.$ref === 'string') {
    const referenced = schema.$ref.replace('#/components/schemas/', '');
    const identifier = names.get(referenced);
    assert.ok(identifier, `dangling reference to ${referenced}`);
    return identifier;
  }

  if (Array.isArray(schema.allOf)) {
    return schema.allOf
      .map((entry) => typeFor(entry, names, indent))
      .join(' & ');
  }

  const union = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(union)) {
    return withNull(
      union.map((entry) => typeFor(entry, names, indent)).join(' | '),
      schema
    );
  }

  if (Array.isArray(schema.enum)) {
    return withNull(schema.enum.map(literal).join(' | '), schema);
  }

  // OpenAPI 3.1 spells "or null" as a type array; 3.0 spelled it `nullable`.
  // This document contains both, because parts of it are written by decorators
  // that predate the upgrade.
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type === undefined
      ? []
      : [schema.type];

  const nullable = types.includes('null') || schema.nullable === true;
  const concrete = types.filter((type) => type !== 'null');

  // A branch of a union that is nothing but `null` is the whole point of that
  // branch: `oneOf: [{ $ref }, { type: 'null' }]` is how a nullable block is
  // spelled, and answering `unknown` for the second half made the union
  // `X | unknown`, which is `unknown`. Every nullable block on the dashboard
  // response was typed away by that until backend plan 0088 was the first
  // document to use the form.
  if (concrete.length === 0) {
    return nullable ? 'null' : 'unknown';
  }

  const rendered = concrete
    .map((type) => {
      if (type === 'array') {
        const item = typeFor(schema.items, names, indent);
        return needsParentheses(item) ? `(${item})[]` : `${item}[]`;
      }
      if (type === 'object') {
        return objectFor(schema, names, indent);
      }
      return PRIMITIVES[type] ?? 'unknown';
    })
    .join(' | ');

  return nullable ? `${rendered} | null` : rendered;
}

/** Whether an array's item type has to be parenthesized before `[]`. */
function needsParentheses(type) {
  return type.includes('|') || type.includes('&') || type.includes(' ');
}

/** `| null` where the schema said so, once a union has already been built. */
function withNull(rendered, schema) {
  const types = Array.isArray(schema.type) ? schema.type : [];
  return types.includes('null') || schema.nullable === true
    ? `${rendered} | null`
    : rendered;
}

/** An object schema as a braced type literal. */
function objectFor(schema, names, indent) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const inner = `${indent}  `;
  const lines = [];

  for (const [name, property] of Object.entries(properties)) {
    const optional = required.has(name) ? '' : '?';
    lines.push(
      `${inner}${propertyKey(name)}${optional}: ${typeFor(property, names, inner)};`
    );
  }

  const extra = schema.additionalProperties;
  if (extra !== undefined && extra !== false) {
    const value = extra === true ? 'unknown' : typeFor(extra, names, inner);
    lines.push(`${inner}[key: string]: ${value};`);
  }

  if (lines.length === 0) {
    // An object with nothing said about it. `Record<string, unknown>` rather
    // than `{}`, which in TypeScript means "anything except null" and would let
    // a number through.
    return 'Record<string, unknown>';
  }

  return `{\n${lines.join('\n')}\n${indent}}`;
}

/** The whole file, as a string. */
export function generate(document) {
  const schemas = document?.components?.schemas ?? {};
  const names = new Map();

  for (const name of Object.keys(schemas)) {
    const identifier = identifierFor(name);
    for (const [taken, existing] of names) {
      assert.notEqual(
        existing,
        identifier,
        `schema names ${taken} and ${name} both produce ${identifier}`
      );
    }
    names.set(name, identifier);
  }

  const blocks = Object.entries(schemas)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, schema]) => declaration(name, schema, names));

  return `${BANNER}\n${blocks.join('\n\n')}\n`;
}

/** One schema as an exported declaration, with whatever the document said about it. */
function declaration(name, schema, names) {
  const identifier = names.get(name);
  const comment = describe(name, schema);
  const body = typeFor(schema, names, '');

  // Always an alias, never an interface, and the difference matters. TypeScript
  // gives a type alias an implicit index signature and an interface none, so a
  // row typed as an interface cannot be handed to anything expecting
  // `Record<string, unknown>`. The generic list and form read a row by field
  // name, which is exactly that, so an interface here would make every
  // descriptor need a cast.
  return `${comment}export type ${identifier} = ${body};`;
}

/** The schema's own description, as a doc comment, plus the name it came from. */
function describe(name, schema) {
  const lines = [`\`${name}\` in the gateway's OpenAPI document.`];

  if (typeof schema.description === 'string' && schema.description !== '') {
    lines.push('', ...schema.description.split('\n'));
  }

  const body = lines
    .map((line) => (line === '' ? ' *' : ` * ${line}`))
    .join('\n');

  return `/**\n${body}\n */\n`;
}

/**
 * The generated source, through prettier.
 *
 * Running the formatter over a file is normally the wrong move in this
 * repository, because most committed files are not prettier clean and rewriting
 * them buries a change in noise. This file is the exception: nothing hand
 * written is in it, so the formatter's opinion is the only one there is, and
 * emitting what it would produce keeps a whole file reformat out of a later
 * diff. It is one named file, never a directory.
 */
async function format(source) {
  const prettier = await import('prettier');
  const options = await prettier.resolveConfig(
    join(workspaceRoot, OUTPUT_PATH)
  );
  return prettier.format(source, {
    ...options,
    filepath: join(workspaceRoot, OUTPUT_PATH),
    // The plugins in `.prettierrc` are for Angular templates and Go templates.
    // Loading them here costs a second of startup on every check and cannot
    // change the output of a file that has no imports and no markup.
    plugins: [],
  });
}

/** The generated file as it should be on disk, read from the committed document. */
export async function generateFromDisk(root = workspaceRoot) {
  const document = JSON.parse(
    readFileSync(join(root, DOCUMENT_PATH), 'utf8').split('\r\n').join('\n')
  );
  return format(generate(document));
}

/**
 * Whether the committed file matches the document, and the file if it does not.
 *
 * Line endings are normalized on both sides before the comparison. A Windows
 * checkout of this repository has CRLF in its working tree and LF in the index,
 * so a byte comparison would report every file as stale on one platform and
 * none on the other.
 */
export async function check(root = workspaceRoot) {
  const expected = await generateFromDisk(root);
  let actual = '';
  try {
    actual = readFileSync(join(root, OUTPUT_PATH), 'utf8');
  } catch {
    return { fresh: false, expected };
  }

  const normalize = (text) => text.split('\r\n').join('\n');
  return { fresh: normalize(actual) === normalize(expected), expected };
}

async function main(argv) {
  const checking = argv.includes('--check');
  const { fresh, expected } = await check();

  if (checking) {
    if (!fresh) {
      process.stderr.write(
        `${OUTPUT_PATH.split('\\').join('/')} is stale. Regenerate it with ` +
          '`npx nx run luna-shopper-admin/models:wire-types` and commit the diff.\n'
      );
      process.exitCode = 1;
    }
    return;
  }

  writeFileSync(join(workspaceRoot, OUTPUT_PATH), expected, 'utf8');
  process.stdout.write(`${OUTPUT_PATH.split('\\').join('/')} written\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
