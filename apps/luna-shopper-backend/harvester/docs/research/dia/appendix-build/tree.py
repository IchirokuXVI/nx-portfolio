import json, re, collections

D = 'C:/Users/Ichi/.claude/jobs/e6841690/tmp/dia2/'
OUT = 'C:/Users/Ichi/.claude/jobs/e6841690/tmp/appendix/'
rows = json.load(open(D + 'category-tree.json', encoding='utf8'))
byid = {r['id']: r for r in rows}

DROP_ROOTS = {'L128', 'L150'}
DROP_LEAVES = {'L2040'}
SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')

notes = []  # slug decisions


def base_slug(r):
    s = r['slugEn']
    c = r.get('canonicalEn')
    if c:
        seg = c.rstrip('/').split('/c/')[0].split('/')[-1]
        if seg != s:
            notes.append((r['id'], f"canonicalEn `{seg}` used instead of slugEn `{s}`"))
            return seg
        notes.append((r['id'], f"canonicalEn last segment `{seg}` equals slugEn, used as is"))
    return s


roots = sorted([r for r in rows if r['level'] == 1 and r['id'] not in DROP_ROOTS and not r.get('hidden')],
               key=lambda r: r['menuOrder'])
tree = []  # dicts with slug, parentSlug, position, diaId, es, en
for pi, root in enumerate(roots):
    rn = {'slug': base_slug(root), 'parentSlug': None, 'position': pi, 'diaId': root['id'], 'es': root['es'], 'en': root['en']}
    tree.append(rn)
    leaves = sorted([r for r in rows if r['parentId'] == root['id'] and not r.get('hidden') and r['id'] not in DROP_LEAVES
                     and r['id'] != root['id']], key=lambda r: r['menuOrder'])
    for li, lf in enumerate(leaves):
        tree.append({'slug': base_slug(lf), 'parentSlug': rn['slug'], 'position': li, 'diaId': lf['id'], 'es': lf['es'], 'en': lf['en'], '_root': rn})
    if root['id'] == 'L105':
        tree.append({'slug': 'other-fruits', 'parentSlug': rn['slug'], 'position': len(leaves), 'diaId': None, 'es': 'Otras frutas', 'en': 'Other fruits', '_root': rn})
tree.append({'slug': 'other', 'parentSlug': None, 'position': len(roots), 'diaId': None, 'es': 'Otros', 'en': 'Other'})
tree.append({'slug': 'uncategorised', 'parentSlug': 'other', 'position': 0, 'diaId': None, 'es': 'Sin categoría', 'en': 'Not yet categorised'})

# collisions
renames = []
cnt = collections.Counter(n['slug'] for n in tree)
dups = {s for s, c in cnt.items() if c > 1}
for s in sorted(dups):
    group = [n for n in tree if n['slug'] == s]
    for n in group:
        if n['parentSlug'] is None:
            renames.append((n['diaId'], s, s, 'root: has no parent root to prefix, keeps the bare slug'))
            continue
        new = f"{n['parentSlug']}-{s}"
        renames.append((n['diaId'], s, new, 'collision prefix'))
        n['slug'] = new
# second pass: collisions that survive the prefix
cnt = collections.Counter(n['slug'] for n in tree)
for s, c in cnt.items():
    if c > 1:
        for n in tree:
            if n['slug'] == s:
                seg = byid[n['diaId']]['slugEs']
                if seg != s.split(n['parentSlug'] + '-')[-1]:
                    pass
        # decided by hand: L2270 Fideos (es "fideos") vs L2273 Noodles; the prefix does not separate siblings
        for n in tree:
            if n['slug'] == s and n['diaId'] == 'L2270':
                new = f"{n['parentSlug']}-fideos"
                renames.append((n['diaId'], s, new, 'prefix leaves both siblings on one slug; DIA Spanish slug `fideos` used as the tail'))
                n['slug'] = new
# extended rule: a new LEAF whose slug equals a CURRENT row of a different level takes the prefix
REF = 'D:/Projects/nx-portfolio/.claude/worktrees/dia-plans/apps/luna-shopper-backend/catalog/src/app/db/reference/categories.ts'
body = open(REF, encoding='utf8').read().split('export const REFERENCE_CATEGORIES')[1].split('export const UNCATEGORISED_SLUG')[0]
cur_level = {}
for m in re.finditer(r"slug: '([^']+)',\s*name: \{\s*en: '([^']*)',\s*es: '([^']*)',?\s*\},?\s*(children: \[)?", body):
    cur_level[m.group(1)] = 'root' if m.group(4) else 'leaf'
assert len(cur_level) == 101
for n in tree:
    if n['parentSlug'] and n['diaId'] and cur_level.get(n['slug']) == 'root':
        new = f"{n['parentSlug']}-{n['slug']}"
        renames.append((n['diaId'], n['slug'], new, 'new leaf equals a current root; takes the parent root prefix so the current root is not reused as a leaf'))
        n['slug'] = new
# the parent slug fields must follow renamed roots (none renamed, but keep it honest)
for n in tree:
    if '_root' in n:
        n['parentSlug'] = n['_root']['slug']

# validation
invalid = []
for n in tree:
    if not SLUG_RE.match(n['slug']) or len(n['slug']) > 80:
        invalid.append(n['slug'])
assert len({n['slug'] for n in tree}) == len(tree), 'dup slugs'

clean = [{k: n[k] for k in ('slug', 'parentSlug', 'position', 'diaId', 'es', 'en')} for n in tree]
json.dump(clean, open(OUT + 'tree.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
json.dump({'renames': renames, 'notes': notes, 'invalid': invalid}, open(OUT + 'work/tree-meta.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('roots', sum(1 for n in clean if n['parentSlug'] is None), 'leaves', sum(1 for n in clean if n['parentSlug']))
print('renames', renames)
print('notes', notes)
print('invalid', invalid)
print('maxlen', max(len(n['slug']) for n in clean), [n['slug'] for n in clean if len(n['slug']) > 60])
