import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from './cli.mjs';
import {
  BRANDS_SHOWN,
  applyCommandLine,
  resumeCommandLine,
  summaryText,
} from './summary.mjs';

test('the summary counts every decision kind and prints the command to paste', () => {
  const text = summaryText({
    runDir: '.curation-runs/2026-09-24',
    reportPath: '.curation-runs/2026-09-24/report.json',
    counts: { LINK: 12, CREATE: 10, REVIEW: 8 },
    report: {
      reviews: [
        { issues: [{ code: 'ROW_FAILED', detail: 'boom' }] },
        { issues: [{ code: 'LOW_CONFIDENCE' }] },
      ],
      unregisteredBrands: [
        { key: 'hacendado', spelling: 'Hacendado', rows: 12 },
        { key: 'deliplus', spelling: 'Deliplus', rows: 1 },
      ],
    },
  });

  assert.equal(
    text,
    [
      '',
      'summary',
      '  decided 30 rows: LINK 12, CREATE 10, REVIEW 8',
      '  1 of the reviews are rows that failed (ROW_FAILED), and the report names the error of each',
      '  unregistered brands: 2. They are also in .curation-runs/2026-09-24/report.json under unregisteredBrands.',
      '    Hacendado (hacendado): 12 rows',
      '    Deliplus (deliplus): 1 row',
      '  report: .curation-runs/2026-09-24/report.json',
      '  apply it with:',
      '    npx nx run luna-shopper/curation-cli:curate -- --apply .curation-runs/2026-09-24/decisions.jsonl',
      '',
    ].join('\n')
  );
});

test('the pasted command is one the orchestrator reads as --apply and nothing else', () => {
  const line = applyCommandLine({ file: '.curation-runs/x/decisions.jsonl' });
  const flags = line.split(' -- ')[1].split(' ');
  assert.deepEqual(parseArgs(flags), {
    apply: '.curation-runs/x/decisions.jsonl',
  });
});

test('a run made as somebody else names them, and never prints a password', () => {
  const line = applyCommandLine({
    file: 'C:\\runs\\x\\decisions.jsonl',
    mainUser: 'curator',
    passwordGiven: true,
  });
  assert.equal(
    line,
    'npx nx run luna-shopper/curation-cli:curate -- --apply C:/runs/x/decisions.jsonl --main-user curator --main-password <password>'
  );
  assert.equal(
    applyCommandLine({ file: 'my runs/decisions.jsonl' }),
    'npx nx run luna-shopper/curation-cli:curate -- --apply "my runs/decisions.jsonl"'
  );
});

test('the brands past the first twenty are left in the report, and it says so', () => {
  const brands = Array.from({ length: 45 }, (_, index) => ({
    key: `brand-${index}`,
    spelling: `Brand ${index}`,
    rows: 45 - index,
  }));
  const text = summaryText({
    runDir: 'r',
    reportPath: 'r/report.json',
    counts: { LINK: 1 },
    report: { unregisteredBrands: brands },
  });
  assert.match(
    text,
    /unregistered brands: 45, the first 20 below\. All of them are in r\/report\.json under unregisteredBrands\./
  );
  assert.equal((text.match(/^ {4}Brand /gm) ?? []).length, BRANDS_SHOWN);
  assert.ok(text.includes('Brand 19 (brand-19)'));
  assert.ok(!text.includes('Brand 20 (brand-20)'));
});

test('a run of reviews only says there is nothing to apply, and prints no command', () => {
  const text = summaryText({
    runDir: 'r',
    reportPath: 'r/report.json',
    counts: { ASSIGN: 0, CREATE_GROUP: 0, REVIEW: 5 },
  });
  assert.match(text, /nothing to apply: every decided row is a REVIEW/);
  assert.ok(!text.includes('--apply'));

  const empty = summaryText({
    runDir: 'r',
    reportPath: 'r/report.json',
    counts: { LINK: 0, CREATE: 0, REVIEW: 0 },
  });
  assert.match(empty, /nothing to apply: no row was decided/);
});

test('a stopped or failed run says how to continue it', () => {
  const text = summaryText({
    runDir: '.curation-runs/x',
    reportPath: '.curation-runs/x/report.json',
    counts: { LINK: 3, REVIEW: 1 },
    stopped: true,
  });
  assert.ok(
    text.includes(
      'npx nx run luna-shopper/curation-cli:curate -- --resume .curation-runs/x'
    )
  );
  assert.ok(
    !summaryText({ runDir: 'r', reportPath: 'p', counts: {} }).includes(
      '--resume'
    )
  );
  assert.equal(
    resumeCommandLine({ runDir: 'r', passwordGiven: true }),
    'npx nx run luna-shopper/curation-cli:curate -- --resume r --main-password <password>'
  );
});
