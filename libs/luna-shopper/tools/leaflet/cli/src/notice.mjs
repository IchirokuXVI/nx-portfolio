/**
 * What a local engine costs, said out loud before the run and after it.
 *
 * `--engine ollama` is the default because a leaflet reading is cheap to redo,
 * the drift check and the baseline already exist to catch a bad one, and a free
 * first pass over a 40 page leaflet is worth having. It is **not** good enough
 * to accept unseen, and the tool has to say so rather than imply it by exiting
 * zero.
 *
 * It is printed **before** the run as well as after, because a warning is worth
 * nothing to somebody who has already waited eleven minutes and started reading
 * the output.
 *
 * **One text, two lengths.** The short form is the long form's first line, so
 * there is no second copy to drift. The short one is what goes into
 * `leaflet.json`, and it goes into `extraction.tool` rather than beside it,
 * because that field is the one `to-harvest-document.mjs` carries through into
 * the document's `producer.name`. A person reading the document next week sees
 * what read it.
 *
 * Whether a notice is printed at all is the registry's `local` flag and never a
 * name, so `claude`, `api` and `manual` get none.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

/** The first line, which is also the whole of what `leaflet.json` carries. */
export function localEngineShortNotice(engine, model) {
  return (
    `Engine: ${engine} ${model}. This model was measured on the El Jamon leaflet ` +
    'and it makes several errors per page.'
  );
}

/** The whole notice, printed before the run and again at the end of it. */
export function localEngineNotice(engine, model) {
  return [
    localEngineShortNotice(engine, model),
    'It found every tile and invented nothing, and it got 63% of headline prices,',
    '55% of ANTES prices and 31% of unit prices right, against 95%, 100% and 100%',
    'for Sonnet 5. On every price drop tile it invented a single unit price the',
    'page does not print.',
    '',
    'Check this reading against the pages before you upload it. For a reading you',
    'do not intend to check, use --engine manual and paste the prompt into a',
    'stronger model.',
  ].join('\n');
}
