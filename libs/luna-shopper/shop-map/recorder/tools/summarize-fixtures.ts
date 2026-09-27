/**
 * Prints the expected numbers of every walk fixture as a Markdown table.
 *
 *   npx tsx libs/luna-shopper/shop-map/recorder/tools/summarize-fixtures.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Summary {
  steps: number;
  turns: number;
  distanceMetres: number;
  endToStartMetres: number;
  final: { x: number; y: number };
  bearing?: number;
  checkpoints: { label: string; errorMetres: number }[];
}

const WALKS = join(__dirname, '..', 'src', '__fixtures__', 'walks');
for (const name of readdirSync(WALKS)) {
  const expected = JSON.parse(
    readFileSync(join(WALKS, name, 'expected.json'), 'utf8')
  ) as {
    truth: Record<string, unknown>;
    modes: Record<string, Record<string, Summary>>;
  };
  console.log(`\n### ${name}\n\ntruth: ${JSON.stringify(expected.truth)}\n`);
  console.log(
    '| mode | model | steps | turns | distance | end to start | final x, y | bearing | checkpoint errors |'
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [mode, models] of Object.entries(expected.modes)) {
    for (const [model, s] of Object.entries(models)) {
      const cps = s.checkpoints
        .map((c) => `${c.label} ${c.errorMetres.toFixed(2)}`)
        .join(', ');
      console.log(
        `| ${mode} | ${model} | ${s.steps} | ${s.turns} | ${s.distanceMetres.toFixed(2)} | ${s.endToStartMetres.toFixed(2)} | ${s.final.x.toFixed(2)}, ${s.final.y.toFixed(2)} | ${s.bearing?.toFixed(2) ?? ''} | ${cps} |`
      );
    }
  }
}
