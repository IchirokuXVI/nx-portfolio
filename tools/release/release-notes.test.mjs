// Tests for the naming rules and the grouping built on them.
//
// Plain `node --test`, not jest: nothing here is an Nx project, and the script
// has to run from a checkout with no node_modules (a release is cut by hand as
// often as by a workflow).
//
//   node --test tools/release/

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isRollup,
  label,
  pullRequestNumber,
  render,
} from './release-notes.mjs';
import { parseTitle, sectionFor, sectionOrder } from './rules.mjs';

describe('parseTitle', () => {
  it('reads type, scope and summary', () => {
    const parsed = parseTitle(
      'feat(velista): the list remembers where you were'
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.type, 'feat');
    assert.deepEqual(parsed.scopes, ['velista']);
    assert.equal(parsed.breaking, false);
    assert.equal(parsed.summary, 'the list remembers where you were');
  });

  it('allows a title with no scope', () => {
    assert.equal(
      parseTitle('fix: the tag no longer moves under the release').ok,
      true
    );
  });

  it('reads several scopes', () => {
    const parsed = parseTitle(
      'docs(luna,velista): the kept list, and a basket to share'
    );
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.scopes, ['luna', 'velista']);
  });

  it('reads the breaking marker', () => {
    const parsed = parseTitle(
      'feat(gateway)!: the envelope wraps every list response'
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.breaking, true);
    assert.equal(sectionFor(parsed), 'Breaking changes');
  });

  it('reads plan references, one or several', () => {
    assert.deepEqual(
      parseTitle('feat(velista): a card that holds the list (plan 0045)').plans,
      ['0045']
    );
    assert.deepEqual(
      parseTitle(
        'feat(velista): the sheet footer and one recorder (plans 0040, 0041)'
      ).plans,
      ['0040', '0041']
    );
    assert.deepEqual(
      parseTitle('fix(luna): the link points somewhere (plan velista 0037)')
        .plans,
      ['0037']
    );
  });

  it('rejects a plan number that is not four digits', () => {
    const parsed = parseTitle(
      'feat(velista): a card that holds the list (plan 45)'
    );
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors.join(' '), /four digits/);
  });

  it('rejects prose with no type', () => {
    const parsed = parseTitle(
      'Velista 0045: your shopping list on the home page'
    );
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors.join(' '), /does not match/);
  });

  it('rejects an unknown type and an unknown scope', () => {
    assert.match(
      parseTitle('feature(velista): a thing that happens').errors.join(' '),
      /is not a type/
    );
    assert.match(
      parseTitle('feat(nope): a thing that happens').errors.join(' '),
      /is not a known scope/
    );
  });

  it('rejects empty parentheses', () => {
    assert.match(
      parseTitle('feat(): a thing that happens').errors.join(' '),
      /empty parentheses/
    );
  });

  it('rejects a trailing full stop, an issue number, and a stub of a summary', () => {
    assert.match(
      parseTitle('fix(velista): the gap is gone.').errors.join(' '),
      /full stop/
    );
    assert.match(
      parseTitle('fix(velista): the gap is gone, see #12').errors.join(' '),
      /issue or pull request/
    );
    assert.match(
      parseTitle('fix(velista): gap').errors.join(' '),
      /too little/
    );
  });

  it('rejects a title longer than the limit', () => {
    const parsed = parseTitle(`feat(velista): ${'a'.repeat(120)}`);
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors.join(' '), /characters/);
  });

  it('rejects a summary that repeats the type', () => {
    assert.match(
      parseTitle('fix(velista): fix the gap in the composer').errors.join(' '),
      /repeats/
    );
  });

  it('survives an empty title', () => {
    assert.equal(parseTitle('').ok, false);
    assert.equal(parseTitle(undefined).ok, false);
  });
});

describe('sections', () => {
  it('keeps the invisible types out of the notes', () => {
    assert.equal(
      sectionFor(parseTitle('feat(velista): a visible change here')),
      'Features'
    );
    assert.equal(
      sectionFor(parseTitle('fix(velista): a visible change here')),
      'Fixes'
    );
    assert.equal(
      sectionFor(parseTitle('chore(deps): bump the pinned node image')),
      null
    );
    assert.equal(
      sectionFor(parseTitle('docs(luna): write down what the harvester does')),
      null
    );
  });

  it('leads with breaking changes', () => {
    assert.equal(sectionOrder()[0], 'Breaking changes');
    assert.deepEqual(sectionOrder().slice(1, 3), ['Features', 'Fixes']);
  });
});

describe('pullRequestNumber', () => {
  it('reads a merge commit and a squash commit', () => {
    assert.equal(
      pullRequestNumber('Merge pull request #86 from IchirokuXVI/worktree-x'),
      86
    );
    assert.equal(
      pullRequestNumber('feat(velista): a card that holds the list (#86)'),
      86
    );
    assert.equal(pullRequestNumber("Merge branch 'worktree-x' into dev"), null);
  });
});

describe('isRollup', () => {
  it('treats a dev or main branch as carrying no work of its own', () => {
    assert.equal(isRollup({ headRefName: 'dev', baseRefName: 'main' }), true);
    assert.equal(isRollup({ headRefName: 'main', baseRefName: 'dev' }), true);
    assert.equal(
      isRollup({ headRefName: 'worktree-velista-0045', baseRefName: 'dev' }),
      false
    );
  });
});

describe('render', () => {
  const entry = (ref, title, kind = 'pr') => ({
    kind,
    ref,
    url: kind === 'pr' ? `https://example.test/${ref}` : null,
    number: kind === 'pr' ? Number(String(ref).replace('#', '')) : undefined,
    parsed: parseTitle(title),
  });

  const entries = [
    entry('#1', 'feat(velista): a card that holds the list (plan 0045)'),
    entry(
      '#2',
      'fix(luna): the confirmation link points at a route velista has'
    ),
    entry('#3', 'chore(deps): bump the pinned node image'),
    entry('#4', 'Voice comments: luna-shopper 0045 and velista 0039'),
    entry(
      'abc1234',
      'fix(k8s): migration Jobs read no ConfigMap key',
      'commit'
    ),
  ];

  const notes = render({
    entries,
    rollups: 1,
    from: 'v0.1.0',
    to: 'v0.2.0',
    version: 'v0.2.0',
    all: false,
    repo: 'o/r',
  });

  it('groups the conforming entries under their sections', () => {
    assert.match(
      notes,
      /## Features\n\n- \*\*velista\*\*: a card that holds the list \(plan 0045\)/
    );
    assert.match(notes, /## Fixes/);
    assert.match(
      notes,
      /\*\*k8s\*\*: migration Jobs read no ConfigMap key \(abc1234\)/
    );
  });

  it('keeps an internal type out unless it is asked for', () => {
    assert.doesNotMatch(notes, /bump the pinned node image/);
    const all = render({
      entries,
      rollups: 0,
      from: null,
      to: 'HEAD',
      version: null,
      all: true,
      repo: null,
    });
    assert.match(all, /## Internal[\s\S]*bump the pinned node image/);
  });

  it('names the titles that cannot be read rather than dropping them', () => {
    assert.match(notes, /## Titles that do not follow the naming rules/);
    assert.match(
      notes,
      /#4: `Voice comments: luna-shopper 0045 and velista 0039`/
    );
  });

  it('counts what it saw, and links the comparison', () => {
    assert.match(
      notes,
      /4 pull requests, 1 commit outside a pull request, 1 rollup skipped\./
    );
    assert.match(notes, /compare\/v0\.1\.0\.\.\.v0\.2\.0/);
  });

  it('links a pull request and leaves a loose commit as a hash', () => {
    assert.equal(
      label(
        entry('#9', 'feat(shell): the host mounts the remote at its own path')
      ),
      '- **shell**: the host mounts the remote at its own path ([#9](https://example.test/#9))'
    );
  });
});
