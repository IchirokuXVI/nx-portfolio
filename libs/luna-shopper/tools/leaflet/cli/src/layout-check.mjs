/**
 * Step 3: the chain's page description, against the pages themselves.
 *
 * `chains/<slug>/layout.md` is a short prose description of one page of that
 * chain's leaflet: the tile layout, the price badge, the decimal separator,
 * loyalty badges or none, the heading banner. A leaflet that no longer matches
 * its own description is a format change, and reading on would misread quietly
 * rather than loudly.
 *
 * This is the one step of the manual procedure that asks a person to look, and
 * the easiest to skip. **A mismatch stops the run and names what differs.**
 *
 * The check is one call over the first three pages, and the model is asked for
 * a verdict and a list of differences rather than for prose, so a stop names
 * something. An answer that cannot be read is treated as a match with a printed
 * note, not as a stop: refusing a whole leaflet because a small model wrote
 * prose would make the default engine unusable, and the sanity pass and the
 * drift check both still run afterwards.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

const HOW_MANY_PAGES = 3;

/** How many pages the check looks at, capped by what the leaflet has. */
export const checkPages = (pages) => pages.slice(0, HOW_MANY_PAGES);

/** What the model is asked, with the chain's own description in it. */
export function layoutPrompt(layout) {
  return [
    'Below is a description of what one page of a supermarket leaflet is supposed',
    'to look like. The images are the first pages of a new leaflet of that chain.',
    '',
    'Answer ONLY with a JSON object, no prose and no code fence:',
    '',
    '{ "matches": true, "differences": [] }',
    '',
    'Set "matches" to false and list every difference as a short sentence when the',
    'pages disagree with the description: a different price badge, a different',
    'decimal separator, a loyalty badge the description does not mention, a',
    'different tile layout, a heading banner that is not there any more.',
    '',
    'A difference is something the description states and the pages contradict. A',
    'detail the description simply does not mention is not a difference.',
    '',
    'THE DESCRIPTION',
    '',
    layout,
  ].join('\n');
}

/** The verdict out of a model answer, or null when it cannot be read. */
export function parseVerdict(text, stripFence) {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  if (typeof parsed.matches !== 'boolean') {
    return null;
  }
  const differences = Array.isArray(parsed.differences)
    ? parsed.differences.filter(
        (entry) => typeof entry === 'string' && entry.trim()
      )
    : [];
  return { matches: parsed.matches, differences };
}

/**
 * The layout check.
 *
 * Answers `{ ok, differences, unreadable }`. The caller stops the run on a
 * false `ok` and prints what differs.
 */
export async function checkLayout({ engine, layout, images, stripFence }) {
  const answer = await engine.ask(layoutPrompt(layout), { images });
  const verdict = parseVerdict(answer?.text, stripFence);
  if (verdict === null) {
    return { ok: true, differences: [], unreadable: true };
  }
  return {
    ok: verdict.matches || verdict.differences.length === 0,
    differences: verdict.differences,
    unreadable: false,
  };
}

/** What the operator reads when the check stops the run. */
export function formatMismatch(slug, differences) {
  return [
    `The first pages do not match what chains/${slug}/layout.md describes, so the run stops here.`,
    'A leaflet that no longer looks like its own description is a format change,',
    'and reading it with a prompt written for the old format misreads quietly.',
    '',
    'What differs:',
    ...differences.map((entry) => `  - ${entry}`),
    '',
    `Look at the pages yourself. If the leaflet really did change, update chains/${slug}/layout.md`,
    'and chains/<slug>/prompt.txt by hand first, which is procedure (b) of the README.',
  ].join('\n');
}
