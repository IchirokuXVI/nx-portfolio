/**
 * Replays the El Jamón walk log of shop-map plan 0002 through the live map of
 * plan 0003, writes what it answers to
 * `libs/luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon/expected-live.json`,
 * and draws it to `tmp/el-jamon-live.html` for checking by eye.
 *
 *   npx tsx tools/shop-map/replay-el-jamon-live.ts
 *
 * Never edit the JSON by hand: check the drawing, then rerun this script.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { elJamonLog } from '../../libs/luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon';
import { replayElJamon } from '../../libs/luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon-live';
import { createLiveMap } from '../../libs/luna-shopper/shop-map/model/src/lib/v2/live-map';

const ROOT = join(__dirname, '..', '..');
const OUT = join(
  ROOT,
  'libs/luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon/expected-live.json'
);

const result = replayElJamon();
writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);

// The walked cells at the end, for the drawing only.
const live = createLiveMap({
  document: { version: 2, areas: [], marks: [], path: [] },
  settings: { idPrefix: 'x', idSeed: 1 },
});
for (const e of elJamonLog.slice(0, 5)) {
  if (e.kind === 'stopped') live.setTracking('lost');
  if (e.kind === 'resumed') live.setTracking(e.seq === 3 ? 'suspect' : 'good');
  for (const ev of e.events) {
    if (ev.type === 'path') {
      for (const [logMs, x, y] of ev.points) live.push({ logMs, x, y });
    }
  }
}
const walked = live.snapshot().walkedCells;

const s = 16;
const xs = walked.map((c) => c.x * 0.5);
const ys = walked.map((c) => c.y * 0.5);
const minX = Math.min(...xs) - 2;
const minY = Math.min(...ys) - 2;
const X = (x: number) => (x - minX) * s;
const Y = (y: number) => (y - minY) * s;
const parts: string[] = [];
for (const c of walked) {
  parts.push(
    `<rect x="${X(c.x * 0.5)}" y="${Y(c.y * 0.5)}" width="${s / 2}" height="${s / 2}" fill="#e3ecd9"/>`
  );
}
for (const e of elJamonLog.slice(0, 5)) {
  if (e.seq === 3) continue;
  for (const ev of e.events) {
    if (ev.type !== 'path') continue;
    parts.push(
      `<polyline fill="none" stroke="#999" stroke-width="1" points="${ev.points
        .map(([, x, y]) => `${X(x)},${Y(y)}`)
        .join(' ')}"/>`
    );
  }
}
const fill: Record<string, string> = {
  suggested: '#8e9ad6',
  'section-run': '#d6a24e',
  'counter-mark': '#b5533c',
};
for (const a of result.map.areas) {
  const colour = a.kind === 'path' ? '#6cc3d5' : (fill[a.origin] ?? '#888');
  parts.push(
    `<rect x="${X(a.x)}" y="${Y(a.y)}" width="${a.w * s}" height="${a.h * s}" fill="${colour}" fill-opacity="0.75" stroke="#333" stroke-width="0.5"><title>${a.id} ${a.kind} ${a.section ?? ''}</title></rect>`
  );
  if (a.section) {
    parts.push(
      `<text x="${X(a.x)}" y="${Y(a.y) - 2}" font-size="9" font-family="sans-serif">${a.section}</text>`
    );
  }
}
for (const g of result.end.suggestions) {
  parts.push(
    `<rect x="${X(g.x)}" y="${Y(g.y)}" width="${g.w * s}" height="${g.h * s}" fill="none" stroke="#3949ab" stroke-dasharray="3 2"/>`
  );
}
for (const m of result.map.marks) {
  const h = (m.heading * Math.PI) / 180;
  parts.push(
    `<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="2.5" fill="#1a237e"/><line x1="${X(m.x)}" y1="${Y(m.y)}" x2="${X(m.x - Math.sin(h))}" y2="${Y(m.y + Math.cos(h))}" stroke="#1a237e"/>`
  );
}
const W = (Math.max(...xs) - minX + 4) * s;
const H = (Math.max(...ys) - minY + 4) * s;
const legend =
  '<p style="font:12px sans-serif">green: walked cells; grey: path; blue: accepted suggestions; cyan: walked across, now path; orange: section runs; red: counters; dashed: suggestions left at the end</p>';
writeFileSync(
  join(ROOT, 'tmp/el-jamon-live.html'),
  `<html><body style="margin:8px;background:#fff">${legend}<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg></body></html>`
);
console.log(
  JSON.stringify(
    {
      atTap: {
        walked: result.atTap.walkedCells,
        suggestions: result.atTap.suggestions.length,
      },
      end: {
        walked: result.end.walkedCells,
        suggestions: result.end.suggestions.length,
        sectionRun: result.end.sectionRun,
      },
      areas: result.map.areas.map(
        (a) => `${a.id} ${a.kind} ${a.origin} ${a.section ?? ''} ${a.w}x${a.h}`
      ),
      eventCounts: result.eventCounts,
    },
    null,
    2
  )
);
