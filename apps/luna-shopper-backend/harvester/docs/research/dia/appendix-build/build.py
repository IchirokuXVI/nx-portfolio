import json, re, collections

D = 'C:/Users/Ichi/.claude/jobs/e6841690/tmp/dia2/'
OUT = 'C:/Users/Ichi/.claude/jobs/e6841690/tmp/appendix/'
REF = 'D:/Projects/nx-portfolio/.claude/worktrees/dia-plans/apps/luna-shopper-backend/catalog/src/app/db/reference/'

rows = json.load(open(D + 'category-tree.json', encoding='utf8'))
byid = {r['id']: r for r in rows}
walk = json.load(open(D + 'walk2.json', encoding='utf8'))['items']
offers = json.load(open(D + 'offers_all.json', encoding='utf8'))
meta = json.load(open(OUT + 'work/tree-meta.json', encoding='utf8'))
tree = json.load(open(OUT + 'tree.json', encoding='utf8'))

# ---------------------------------------------------------------- name cleanup
cleaned = []
for n in tree:
    for k in ('es', 'en'):
        v = n[k]
        nv = re.sub(r'[\u200b-\u200f\u2060\ufeff]', '', v).replace('\u00a0', ' ')
        nv = re.sub(r' {2,}', ' ', nv)
        if nv != v:
            cleaned.append((n['diaId'], k, repr(v), nv))
            n[k] = nv
json.dump(tree, open(OUT + 'tree.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)

slug_of = {n['diaId']: n['slug'] for n in tree if n['diaId']}
node = {n['slug']: n for n in tree}
roots = [n for n in tree if n['parentSlug'] is None]
leaves = [n for n in tree if n['parentSlug']]
kept_leaf_ids = {n['diaId'] for n in leaves if n['diaId']}

# ---------------------------------------------------------------- appendix A
renamed = {r[0]: r for r in meta['renames'] if r[1] != r[2]}
slugnote = {i: s for i, s in meta['notes']}
L = []
L.append('## Appendix A. The new category tree\n')
L.append(f'**{len(roots)} roots, {len(leaves)} leaves, {len(tree)} rows.** '
         f'{len(roots) - 1} roots and {len(leaves) - 2} leaves are copied from DIA\'s menu; '
         'the leaf `other-fruits` and the root `other` with its leaf `uncategorised` are ours and carry no DIA id.\n')
L.append('Positions count from 0 within each sibling group and follow DIA\'s menu order. '
         'Names are DIA\'s own, except that invisible characters (zero width and non breaking spaces) were cleaned out of four of them, listed below the tables. '
         'A slug is the last segment of DIA\'s English URL unless the note under the tables says otherwise.\n')
L.append('English names that look like machine translation errors, copied verbatim and not corrected:\n')
L.append('| DIA id | es | en |')
L.append('| --- | --- | --- |')
for i in ['L2266', 'L2128', 'L2140', 'L2319', 'L2216', 'L2135', 'L2146', 'L2304', 'L2078', 'L2167', 'L2280']:
    nn = next(x for x in tree if x['diaId'] == i)
    L.append(f"| {i} | {nn['es']} | {nn['en']} |")
L.append('')
for r in roots:
    dia = f", {r['diaId']}" if r['diaId'] else ', no DIA id'
    L.append(f"### {r['position']}. {r['es']} / {r['en']} (`{r['slug']}`{dia})\n")
    L.append('| Pos | DIA id | slug | es | en |')
    L.append('| --- | --- | --- | --- | --- |')
    for lf in [x for x in leaves if x['parentSlug'] == r['slug']]:
        L.append(f"| {lf['position']} | {lf['diaId'] or '(ours)'} | `{lf['slug']}` | {lf['es']} | {lf['en']} |")
    L.append('')
L.append('### Slug decisions\n')
L.append('| DIA id | DIA slug | slug used | why |')
L.append('| --- | --- | --- | --- |')
for i, s in meta['notes']:
    if 'instead' in s:
        L.append(f"| {i} | `{byid[i]['slugEn']}` | `{slug_of[i]}` | the category's canonical English URL names it `{slug_of[i]}` |")
    else:
        L.append(f"| {i} | `{byid[i]['slugEn']}` | `{slug_of[i]}` | canonical URL sits under another root (`/en/butchery/chicken`) but its last segment is the same |")
seen = set()
for i, old, new, why in meta['renames']:
    if i in seen and i != 'L2270':
        continue
    if 'current root' in why:
        L.append(f"| {i} | `{old}` | `{new}` | `{old}` is a current root; a new leaf equal to a current row of another level takes the parent root prefix, so the current root is not reused as a leaf |")
        continue
    if old == new:
        L.append(f"| {i} | `{old}` | `{new}` | collides with a leaf; a root has no parent root to prefix, so the root keeps the bare slug and only the leaf is prefixed |")
    elif i == 'L2270' and 'fideos' in new:
        L.append(f"| {i} | `noodles` | `{new}` | collides with its sibling L2273, so the parent prefix alone cannot separate them; DIA's Spanish segment `fideos` is used as the tail (L2273, named Noodles in both languages, keeps `noodles`) |")
    elif i != 'L2270':
        L.append(f"| {i} | `{old}` | `{new}` | `{old}` is used by another node; both take the parent root slug as a prefix |")
    seen.add(i)
L.append('\nEvery slug matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`; the longest is '
         f"{max(len(n['slug']) for n in tree)} characters, and all {len(tree)} are unique.\n")
L.append('### Names cleaned\n')
L.append('| DIA id | field | as DIA serves it | as copied |')
L.append('| --- | --- | --- | --- |')
for i, k, a, b in cleaned:
    L.append(f'| {i} | {k} | `{a}` | {b} |')
open(OUT + 'appendix-a-tree.md', 'w', encoding='utf8').write('\n'.join(L))

# ---------------------------------------------------------------- appendix B
def skus_in(cid):
    return [s for s, it in walk.items() if cid in it['cats']]


def only_there(cid, family=None):
    fam = family or {cid}
    out = []
    for s, it in walk.items():
        cs = set(it['cats'])
        if cs & fam and not (cs & kept_leaf_ids):
            out.append(it['name'])
    return out


def hidden_name(r):
    return r['slugEs'].replace('-', ' ').capitalize()


REDIRECT = {
    'L2040': ('other-fruits', 'rule 4: seasonal fruit DIA files only here (granada, chirimoya, ciruela, melocotón, nectarina)'),
    'L2254': ('pork', 'Christmas only; the walk shows 2 pork, 1 beef, 1 chicken cut, pork is the majority'),
    'L2224': ('red-wine', 'Christmas only; red wine is the largest group of its 46'),
    'L2218': ('chocolates-and-bonbons', 'Christmas only, empty today; turrón has no menu leaf, chocolates and bonbons is the nearest confectionery leaf (doubt)'),
    'L2256': ('dried-fruit', 'Christmas only; 6 of its 9 are dried fruit, 3 are nuts'),
    'L2225': ('savory-snacks', 'Christmas only; today broths (3) and crisps (3), so no kind dominates; a starter is closest to a savoury snack (doubt)'),
    'L2220': ('muffins-and-classic-pastries', 'Christmas only; all 9 (panettone, pandoro) also sit there'),
    'L2257': ('traditional-desserts', 'Christmas only; all 12 also sit there'),
    'L2221': ('muffins-and-classic-pastries', 'Christmas only; both products (marquesas, mantecados) appear nowhere else; DIA files its panettones in that leaf'),
    'L2219': ('chocolate-and-filled-biscuits', 'Christmas only; 2 of 3 are filled wafers, the third (pastas) is a classic biscuit'),
    'L2189': ('chocolate-and-filled-biscuits', 'Christmas only (under a retired root); both products are filled wafers seen nowhere else'),
}
WHY = {}
for r in rows:
    if r['id'] == 'L128':
        WHY[r['id']] = 'dropped root (rule 2): new arrivals and recommendations, a merchandising branch'
    elif r['parentId'] == 'L128':
        WHY[r['id']] = 'child of dropped root L128'
    elif r['id'] == 'L150':
        WHY[r['id']] = 'offer listing, not a branch of the tree'
    elif r['id'] == 'L2040':
        WHY[r['id']] = 'dropped leaf (rule 2); replaced by `other-fruits`'
    elif r.get('hidden'):
        par = r['parentSlugEs']
        kind = {'navidad': 'Christmas campaign', 'verano': 'summer campaign', 'sin-gluten': 'retired gluten free root',
                'novedades-y-recomendados': 'campaign under L128', 'mascotas': 'dormant pets leaf',
                'azucar-chocolates-y-caramelos': 'Christmas leaf under a retired root'}[par]
        WHY[r['id']] = f'hidden, not in the menu ({kind}, `/{par}/`)'

B = []
B.append('## Appendix B. DIA nodes not copied\n')
B.append('Every node of DIA\'s tree that the new tree leaves out. "Products" is the listing walk\'s count (for L150, the '
         'offers endpoint\'s total). "Only there" counts products the walk found under that node and under **no copied '
         'leaf**, so they would have nowhere to land without a redirect. The redirect slug is where such a product is '
         'filed; `none` means every product seen there also sits under a copied leaf, and that leaf\'s own mapping is '
         'enough. The "Todo X" pseudo children are not listed: they repeat their parent\'s id and are not nodes.\n')
B.append('Names of hidden nodes are not served by DIA; they are shown here as the Spanish URL segment, in italics.\n')
B.append('| DIA id | es | why dropped | products | products only there | redirect slug |')
B.append('| --- | --- | --- | --- | --- | --- |')
dmap = {}
brows = []
order = ['L128'] + [r['id'] for r in sorted([r for r in rows if r['parentId'] == 'L128'], key=lambda r: r['menuOrder'])] + ['L2040', 'L150'] + \
        [r['id'] for r in rows if r.get('hidden')]
for i in order:
    r = byid[i]
    es = r['es'] if r['es'] else f"*{hidden_name(r)}*"
    if i == 'L128':
        fam = {x['id'] for x in rows if x['parentId'] == 'L128'} | {'L128'}
        o = only_there(i, fam)
        prods = r['productCount']
    elif i == 'L150':
        walked = set(walk)
        orph = [it for it in offers['items'] if not (it['sku'] in walked and set(walk[it['sku']]['cats']) & kept_leaf_ids)]
        o = [it['name'] for it in orph]
        prods = offers['total']
    else:
        o = only_there(i)
        prods = len(skus_in(i))
    red, why = REDIRECT.get(i, ('none', ''))
    if i == 'L150':
        why = f'only the first {len(offers["items"])} of {offers["total"]} offers were fetched; every one of those also sits under a copied leaf'
    if i == 'L2176':
        why = 'empty; no kept leaf holds pets other than cats and dogs, so a product seen here would fall to `uncategorised`'
    oc = str(len(o))
    if o:
        oc += ' (' + '; '.join(x[:40] for x in o[:5]) + ('; ...' if len(o) > 5 else '') + ')'
    cell = f'`{red}`' if red != 'none' else 'none'
    if why:
        cell += f' <br>{why}'
    B.append(f"| {i} | {es} | {WHY[i]} | {prods} | {oc} | {cell} |")
    if red != 'none':
        dmap[i] = red
        assert red in node and node[red]['parentSlug'], red
    brows.append((i, len(o)))
B.append('')
B.append(f'Nodes listed: {len(order)} (1 dropped root with its 6 children, L2040, L150, and {sum(1 for r in rows if r.get("hidden"))} hidden leaves). '
         f'Products seen only under a dropped node: 16 distinct, of the walk\'s {len(walk)}, spread over '
         f'{sum(1 for i, n in brows if n and i != "L128")} nodes (L2040 11, L2219 3, L2221 2, L2189 2; the two filled wafers sit under both L2219 and L2189). '
         'This agrees with `drop-analysis.json` (`orphansClear.count` 16). Every other dropped node, the whole of L128 included, holds only products that also sit under a copied leaf.\n'
         '\nThe Christmas leaves get a redirect even where today\'s products all sit elsewhere, because they are Christmas only: in December they fill with seasonal stock DIA may file nowhere else. '
         'Summer, gluten free and campaign leaves get `none`, since the walk shows their stock is always cross filed.\n')
open(OUT + 'appendix-b-dia-not-copied.md', 'w', encoding='utf8').write('\n'.join(B))

# ---------------------------------------------------------------- dia-map
full = {n['diaId']: n['slug'] for n in tree if n['diaId']}
full.update(dmap)
json.dump(dict(sorted(full.items(), key=lambda kv: int(kv[0][1:]))), open(OUT + 'dia-map.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)

# ---------------------------------------------------------------- old tree
src = open(REF + 'categories.ts', encoding='utf8').read()
old = []  # (slug, level, parent, es)
body = src.split('export const REFERENCE_CATEGORIES')[1].split('export const UNCATEGORISED_SLUG')[0]
cur_root = None
for m in re.finditer(r"slug: '([^']+)',\s*name: \{\s*en: '([^']*)',\s*es: '([^']*)',?\s*\},?\s*(children: \[)?", body):
    slug, en, es, ch = m.groups()
    if ch:
        cur_root = slug
        old.append((slug, 'root', None, es, en))
    else:
        old.append((slug, 'leaf', cur_root, es, en))
assert sum(1 for o in old if o[1] == 'root') == 17 and sum(1 for o in old if o[1] == 'leaf') == 84, len(old)

# seed products per current slug (authored + mercadona)
seed = collections.defaultdict(list)
for f in ['authored.ts', 'mercadona.ts']:
    s = open(REF + f, encoding='utf8').read()
    for m in re.finditer(r"name: \{ en: '([^']*)', es: '([^']*)' \},\s*group: '([^']*)',\s*categories: \[([^\]]*)\]", s):
        for c in re.findall(r"'([^']+)'", m.group(4)):
            seed[c].append(m.group(2))

M = {
    # root: (new root, note)
    'fruit-and-vegetables': ('vegetables', 'spans `fruits` and `vegetables` (and nuts, now under `snacks-and-nuts`); vegetables holds most of it (DIA 209 against 74; seed 4 against 1). The new root is the row of the current leaf `vegetables`'),
    'meat': ('meats', ''),
    'cold-cuts-and-cheese': ('charcuterie', 'spans `charcuterie` and `cheeses`; charcuterie holds most (DIA 188 against 133; seed 26 against 10)'),
    'fish-and-seafood': ('fish-and-seafood', 'same slug, same row'),
    'dairy-and-eggs': ('eggs-milk-and-butter', 'spans `eggs-milk-and-butter` and `yoghurts-and-desserts`; five of its six leaves go to the first (DIA 204 against 187). doubt: the seed holds 7 desserts and 1 egg, so by seed products it would be `yoghurts-and-desserts`'),
    'bakery': ('bakery', 'same slug, same row. Spans `bakery` and `pastries-cakes-and-sugar` (its pastries); bakery holds more (DIA about 155 against 145)'),
    'breakfast-and-sweets': ('biscuits-cereals-and-jams', 'spans `biscuits-cereals-and-jams`, `chocolates-and-sweets` and `coffee-cocoa-and-infusions`. doubt: a near tie, DIA about 369 against 338 once cocoa spreads follow jams; the seed ties 5, 5 and 5; picked the breakfast one'),
    'pantry': ('oils-sauces-and-spices', 'spans `oils-sauces-and-spices`, `canned-food-broths-and-creams`, `rice-pasta-and-pulses` and `pastries-cakes-and-sugar` (flour, sugar). doubt: the first three are close (DIA about 324, 305, 223 once pasta sauces follow sauces); seed 7, 3, 2'),
    'frozen': ('frozen-foods-and-ice-cream', 'the current row `frozen` has no counterpart in the new tree (the DIA leaf L2249 Congelado is `fish-and-seafood-frozen`); the migration deletes it after remapping'),
    'ready-meals': ('prepared-meals-and-pizzas', ''),
    'snacks': ('snacks-and-nuts', ''),
    'drinks': ('beers-wines-and-spirits', 'spans `beers-wines-and-spirits`, `water-and-soft-drinks` and `juices-and-smoothies`; beers, wines and spirits holds most (DIA 469, 274, 120). doubt: by seed products water wins (5 against 4)'),
    'baby': ('children', ''),
    'pets': ('pets', 'same slug, same row'),
    'household': ('cleaning-and-home', ''),
    'personal-care': ('hygiene-and-body-care', 'spans `hygiene-and-body-care`, `hair-and-perfumery` and `health-and-pharmacy`; hygiene holds most (DIA 324, 304, 73)'),
    'other': ('other', 'same slug, same row'),
    # leaves
    'fruit': ('other-fruits', 'split: every fruit leaf (`bananas-and-plantains`, `apples-and-pears`, `oranges-tangerines-and-lemons`, `melon-and-watermelon`, `grapes`, `tropical-fruits`, `red-and-forest-fruits`); no DIA leaf is fruit in general, so the catch all. The seed\'s Plátanos belongs in `bananas-and-plantains`'),
    'vegetables': ('tomatoes-peppers-and-cucumbers', 'split: `lettuce-and-leafy-greens`, `garlic-onions-and-leeks`, `courgette-pumpkin-and-aubergine`, `potatoes-and-carrots`, `broccoli-cauliflower-and-green-beans`, `mushrooms`. doubt: DIA has no general vegetable leaf and no vegetable catch all; picked its largest fresh vegetable leaf. Seed: 2 mushrooms, 1 aubergine, 1 grilled vegetable mix. The slug `vegetables` itself becomes the root'),
    'salads-and-herbs': ('lettuce-and-leafy-greens', 'split: `aromatic-herbs`, `salads-and-prepared-vegetables`'),
    'nuts-and-dried-fruit': ('nuts', 'split: `mixed-nuts`, `dried-fruit`. Moves to root `snacks-and-nuts`'),
    'other-produce': ('other-fruits', 'doubt: the only catch all in either produce root; a vegetable left here would sit under Frutas'),
    'poultry': ('chicken', 'split: `turkey`'),
    'pork': ('pork', 'same slug, same row; parent changes from `meat` to `meats`'),
    'beef-and-lamb': ('beef', 'doubt: DIA has no lamb leaf'),
    'minced-and-burgers': ('hamburgers-ground-beef-and-meatballs', ''),
    'other-meat': ('breaded-and-prepared-foods', 'doubt: no general meat leaf; split: `rabbit`, `cuts-and-cuts`'),
    'cured-ham-and-sausages': ('serrano-ham', 'split: `fuet-and-salchichon`, `loin-and-chorizo`. Seed: 4 fuet, salchichón or salami, 2 chorizo, 2 cured ham'),
    'sliced-cold-cuts': ('cooked-ham', 'split: `turkey-and-chicken`, `chopped-and-mortadella`, `bacon`. Seed: 2 bacon, chopped, paleta, mortadela, turkey breast'),
    'cheese': ('semi-cured', 'split: `cured`, `young-mild`, `cheeses-fresh`, `specialties`, `blue-and-goat-cheese`, `sliced`, `shredded-grated`, `spreadable-and-portions`. Moves to root `cheeses`'),
    'pates-and-spreads': ('pate-and-sobrasada', 'split: `pates` (canned pâtés under `canned-food-broths-and-creams`; DIA files many pâtés in both)'),
    'other-cold-cuts': ('sausages', 'doubt: no general charcuterie leaf; the seed holds 3 sausages and a cabeza de jabalí; split: `chopped-and-mortadella`'),
    'fresh-fish': ('fish-and-seafood-fresh', ''),
    'shellfish': ('seafood-shrimp-and-squid', 'split: `mussels-cockles-and-fish` (canned)'),
    'smoked-and-salted-fish': ('smoked-and-salted', ''),
    'other-seafood': ('surimi-and-prepared-products', 'doubt: no general fish leaf; split: `fish-and-seafood-frozen`, `breaded`'),
    'milk': ('milk', 'same slug, same row; parent changes from `dairy-and-eggs` to `eggs-milk-and-butter`. split: `lactose-free-and-fortified-milk`, `condensed-and-evaporated-milk`'),
    'plant-drinks': ('plant-based-drinks-and-horchata', ''),
    'yogurts-and-desserts': ('natural-and-skimmed-yogurts', 'split: every leaf of `yoghurts-and-desserts` (`flavoured-and-fruit-yoghurts`, `greek-yogurts`, `liquid-yogurts`, `bifidus-yoghurts-and-cholesterol`, `kefir-and-plant-based-desserts`, `protein-desserts-and-yogurts`, `yogurts-and-children-s-desserts`, `traditional-desserts`, `custard-flan-and-rice-pudding`, `gelatins-and-curds`). doubt: the seed\'s 7 are desserts (3 flans, mousse, panna cotta, tarta al whisky) and 1 Greek yogurt, and would land in `custard-flan-and-rice-pudding` or `traditional-desserts`'),
    'butter-and-cream': ('butter-and-margarine', 'split: `cream`'),
    'eggs': ('eggs', 'same slug, same row; parent changes from `dairy-and-eggs` to `eggs-milk-and-butter`'),
    'other-dairy': ('milkshakes', 'doubt: no general dairy leaf; split: `kefir-and-plant-based-desserts`, `gelatins-and-curds`, `condensed-and-evaporated-milk`'),
    'bread': ('freshly-baked-bread', 'split: `sliced-and-specialty-breads`, `hamburger-and-hot-dog-buns`, `wheat-tortillas-and-pita-bread`, `gluten-free-bread`. Seed: 3 sliced loaves, 1 hot dog bun, 1 bocatín'),
    'pastries-and-cakes': ('muffins-and-classic-pastries', 'split: `sweet-baked-goods`, `doughnuts-and-cakes`, `pastries-cakes-and-sugar-cakes`. Moves to root `pastries-cakes-and-sugar`'),
    'toasts-and-crispbread': ('breadcrumbs-toasted-bread-and-breadsticks', ''),
    'other-bakery': ('oven', 'doubt: `oven` (Horno, the in store bakery counter) is the widest; split: `doughs-and-pastries`'),
    'cereals': ('cereals', 'same slug, same row; parent changes from `breakfast-and-sweets` to `biscuits-cereals-and-jams`. split: `whole-grain-cereals-and-muesli`'),
    'biscuits': ('classic-and-digestive-biscuits', 'split: `chocolate-and-filled-biscuits`, `savory-biscuits-and-crackers`'),
    'jam-honey-and-spreads': ('jams', 'split: `sugar-honey-and-sweeteners` (honey), `cocoa-spreads-and-creams`'),
    'chocolate-and-sweets': ('sweets', 'split: `milk-chocolate`, `dark-chocolate`, `white-chocolate`, `chocolates-and-bonbons`, `chewing-gum-and-candies`. Moves to root `chocolates-and-sweets`; `sweets` is its widest leaf'),
    'coffee-tea-and-cocoa': ('ground-coffee', 'split: every leaf of `coffee-cocoa-and-infusions` (capsules of three kinds, `instant-coffee`, `whole-bean-coffee`, `cold-brew-coffee`, `cocoa-and-hot-chocolate`, `infusions`, `tea`). Seed: 2 capsules, 2 cold coffees, 1 infusion, none ground'),
    'other-breakfast': ('cereal-and-protein-bars', 'doubt: no general breakfast leaf'),
    'pasta-rice-and-legumes': ('macaroni-spaghetti-and-dried-pasta', 'split: `rice`, `rice-pasta-and-pulses-fideos`, `chickpeas-and-beans`, `lentils`, `quinoa-couscous-and-soy`. Seed: chickpeas and fideos'),
    'canned-food': ('canned-food-broths-and-creams-canned-vegetables', 'split: `tuna-and-bonito`, `mackerel-and-sardines`, `mussels-cockles-and-fish`, `canned-fruit`. Seed: 2 sardines, 1 whole tomato'),
    'oil-and-vinegar': ('oils', 'split: `vinegars-and-dressings`'),
    'sauces-and-condiments': ('ketchup-mayonnaise-and-mustard', 'split: `tomato-and-pasta-sauces` (seed: 2 tomate frito), `special-and-spicy-sauces`, `pasta-sauces`'),
    'flour-sugar-and-baking': ('flours-and-yeasts', 'split: `sugar-honey-and-sweeteners`, `dessert-mixes-and-decorations`. Moves to root `pastries-cakes-and-sugar`'),
    'spices-and-salt': ('spices-and-herbs', 'split: `garlic-salt-and-pepper` (seed salt), `seasonings`'),
    'soups-and-stock': ('broths-and-soups', 'split: `creams-and-purees`. Moves to root `canned-food-broths-and-creams`'),
    'other-pantry': ('quinoa-couscous-and-soy', 'doubt: no general pantry leaf in any of the four roots; the seed\'s one product (a revuelto mix) fits none'),
    'frozen-vegetables': ('frozen-and-steamed-vegetables', 'split: `vegetables-and-potatoes` (the frozen root\'s own vegetable leaf). Moves to root `vegetables`, whose leaf carries the same name'),
    'frozen-fish-and-seafood': ('frozen-foods-and-ice-cream-fish-and-seafood', 'split: `fish-and-seafood-frozen`'),
    'frozen-meals-and-pizzas': ('pizzas-and-doughs', 'split: `rice-and-pasta`, `croquettes-and-batters`, `frozen-pizzas` (under `prepared-meals-and-pizzas`)'),
    'ice-cream': ('ice-creams-and-ice', ''),
    'other-frozen': ('croquettes-and-batters', 'doubt: no general frozen leaf; split: `rice-and-pasta`, `cakes-and-churros`'),
    'pizzas': ('refrigerated-pizzas', 'split: `frozen-pizzas`. The seed\'s three pizzas are frozen and also carry `frozen-meals-and-pizzas`'),
    'prepared-dishes': ('traditional-food', 'split: `ready-to-eat-dishes`, `mexican-food`, `asian-food`'),
    'salads-and-sandwiches': ('salads-and-bowls', 'split: `sandwiches-and-burgers`'),
    'fresh-pasta-and-dough': ('filled-and-sauced-pasta', 'split: `doughs-and-pastries` (bakery). Moves to root `rice-pasta-and-pulses`'),
    'other-ready-meals': ('ready-to-eat-dishes', 'split: `tortillas-and-pies`, `gazpachos-and-salmorejos`, `hummus-and-guacamole`'),
    'crisps': ('potato-chips', ''),
    'salty-snacks': ('savory-snacks', 'split: `vegetable-snacks`, `savory-biscuits-and-crackers` (seed: galletas saladas)'),
    'olives-and-pickles': ('olives', 'split: `pickles`'),
    'other-snacks': ('savory-snacks', 'the widest snack leaf'),
    'water': ('water', 'same slug, same row; parent changes from `drinks` to `water-and-soft-drinks`'),
    'soft-drinks': ('cola', 'split: `orange-lemon-and-lemon-lime`, `tonic-sparkling-water-and-bitter`, `iced-tea`, `non-carbonated-soft-drinks`, `energy-drinks`, `water-and-soft-drink-packs`'),
    'juices': ('multifruit-and-other-flavors', 'split: every leaf of `juices-and-smoothies` (`orange`, `peach-and-pineapple`, `fruit-and-milk`, and the rest). Seed: 1 fruit and milk'),
    'beer': ('beers', 'split: `premium-and-specialty-beers`, `beers-with-lemon`, `non-alcoholic-beers`, `beer-packs`'),
    'wine-and-cava': ('red-wine', 'split: `white-wine` (the seed\'s one wine), `rose-wine`, `cavas-and-cider`, `summer-red-wine-and-sangria`'),
    'spirits': ('gin-vodka-and-tequila', 'split: `ron-and-whisky`, `creams-liqueurs-and-brandy`, `vermouth-and-aperitifs`'),
    'other-drinks': ('non-carbonated-soft-drinks', 'doubt: no general drinks leaf; split: `isotonic-and-sports-drinks`, `kombucha-and-vitamin-infused-waters`'),
    'baby-food': ('baby-foods-and-jars', 'split: `milk-and-baby-food`, `pots-and-snacks`, `yogurt-and-desserts`, `infant-formula`'),
    'nappies-and-wipes': ('diapers-and-wipes', ''),
    'other-baby': ('hygiene-and-care', 'the widest baby leaf'),
    'dogs': ('dry-dog-food', 'split: `wet-dog-food`, `dog-treats-and-care`. The seed\'s three dog products (chews, sausages, waste bags) all belong in `dog-treats-and-care`'),
    'cats': ('dry-cat-food', 'split: `wet-cat-food`, `cat-treats-and-care`'),
    'other-pets': ('uncategorised', 'doubt: DIA has leaves for cats and dogs only (its other animals leaf L2176 is hidden and empty), so nothing fits'),
    'cleaning': ('cleaning-floors-windows-and-furniture', 'split: `bathroom-and-toilet-cleaning`, `kitchen-cleaning-and-degreasing`, `bleach-and-disinfectants`, `garbage-bags-brooms-and-mops`, `scouring-pads-cloths-and-gloves`. Seed: 4 floor cleaners, 3 WC, bleach, mop, bucket, furniture polish'),
    'laundry': ('detergents', 'split: `fabric-softeners-and-laundry-care` (all three seed products: perfume pearls and two stain removers)'),
    'dishwashing': ('dishwasher', 'Lavavajillas covers hand and machine dishwashing'),
    'paper-and-wipes': ('toilet-paper-kitchen-paper-and-napkins', ''),
    'bags-foil-and-wrap': ('film-aluminum-and-preservation', 'split: `garbage-bags-brooms-and-mops`, `batteries-kitchenware-and-bags` (seed: shopping bag)'),
    'other-household': ('batteries-kitchenware-and-bags', 'the widest household leaf; split: `air-fresheners-refills-and-candles` (seed: 2 air fresheners), `insecticides` (seed: 1 refill)'),
    'hair': ('shampoo', 'split: `conditioners-and-masks`, `foams-and-fixers`, `dyes`. Moves to root `hair-and-perfumery`'),
    'skin-and-body': ('body-and-hand-hydration', 'split: `shower-gel-and-sponges`, `hand-soap`, `facial-care`. Seed: one of each of the last three'),
    'oral-care': ('oral-hygiene', ''),
    'shaving-and-deodorant': ('deodorants', 'split: `shaving`, `hair-removal`'),
    'feminine-care': ('sanitary-pads-and-feminine-hygiene', ''),
    'pharmacy': ('parapharmacy', 'split: `first-aid-kit`, `nutritional-supplements`, `sunscreen`. Moves to root `health-and-pharmacy`'),
    'other-personal-care': ('facial-care', 'doubt: DIA has no makeup or nail leaf; 11 of the seed\'s 13 are cosmetics (nail lacquers, blush, lip liner), and facial care is where DIA files make up removers and lip balm. Moves to root `hair-and-perfumery`'),
    'uncategorised': ('uncategorised', 'same slug, same row'),
}
assert set(M) == {o[0] for o in old}, set(M) ^ {o[0] for o in old}
# second rule (coordinator): leaves that are catch-alls or doubtful go to uncategorised
leaf_slugs = {o[0] for o in old if o[1] == 'leaf'}
for k in list(M):
    if k not in leaf_slugs or k == 'uncategorised':
        continue
    tgt, note = M[k]
    if k.startswith('other-'):
        rest = note.replace('doubt: ', '')
        M[k] = ('uncategorised', f'catch-all: no DIA leaf holds the same kind ({rest})' if tgt == 'uncategorised' else f'catch-all: no DIA leaf holds the same kind. The nearest guess was `{tgt}` ({rest})' if rest else
                f'catch-all: no DIA leaf holds the same kind. The nearest guess was `{tgt}`')
    elif 'doubt:' in note and k != 'beef-and-lamb':
        M[k] = ('uncategorised', f'{note}. The nearest guess was `{tgt}`')
C = []
C.append('## Appendix C. Current rows to new rows\n')
C.append('Every row of the current tree (17 roots, 84 leaves) mapped to exactly one row of the new tree: a root to a new root '
         '(for shop sections that point at a root), a leaf to a new leaf (for the products on it). '
         '`split:` names the other leaves the current one\'s products spread over; `doubt:` marks a weak fit. '
         'Where a current root spans several new roots, the note says which holds most of its products, measured on DIA\'s '
         'assortment in the leaves its own leaves map to, with the reference seed\'s products beside it.\n')
nl_dia = sum(1 for o in old if o[1] == 'leaf' and M[o[0]][0] != 'uncategorised')
nl_unc = sum(1 for o in old if o[1] == 'leaf' and M[o[0]][0] == 'uncategorised')
C.insert(1, f'**Of the 84 current leaves, {nl_dia} map to a DIA leaf (or our `other-fruits`) and {nl_unc} map to `uncategorised`** '
         f'(the current `uncategorised` itself, {sum(1 for o in old if o[0].startswith("other-") and o[1] == "leaf")} `other-*` catch-alls, and '
         f'{nl_unc - 1 - sum(1 for o in old if o[0].startswith("other-") and o[1] == "leaf")} doubtful leaves). The 17 root mappings are for shop sections only.\n')
C.append('Leaf rule: in a cluster every product sits on one of the plan 0166 landing leaves (the `other-*` catch-alls and `uncategorised`), so a guessed '
         'target would misfile a whole cluster at once. Every `other-*` leaf and every leaf marked `doubt:` therefore maps to `uncategorised`, where the '
         'products wait to be filed properly; the one exception is `beef-and-lamb`, which keeps `beef`. A `split:` leaf keeps its best single target. '
         'The note keeps the nearest guess for reference.\n')
C.append('| current slug | level | new slug | new es | note |')
C.append('| --- | --- | --- | --- | --- |')
o2n = {}
for slug, lvl, par, es, en in old:
    new, note = M[slug]
    n = node[new]
    if lvl == 'root':
        assert n['parentSlug'] is None, (slug, new)
    else:
        assert n['parentSlug'] is not None, (slug, new)
    o2n[slug] = new
    extra = (' ' if note else '') + f"(seed: {len(seed.get(slug, []))} product{'s' if len(seed.get(slug, [])) != 1 else ''})" if lvl == 'leaf' and slug in seed and 'Seed' not in note and 'seed' not in note else ''
    C.append(f"| `{slug}` | {lvl}{'' if lvl == 'root' else ' of `' + par + '`'} | `{new}` | {n["es"]} | {note}{extra} |")
counts = collections.Counter(('split' if 'split:' in M[s][1] else '') + ('doubt' if 'doubt:' in M[s][1] else '') for s in M)
C.append('')
C.append(f"Rows marked split: {sum(1 for s in M if 'split:' in M[s][1])}; marked doubt: {sum(1 for s in M if 'doubt:' in M[s][1])}. "
         f"New rows used: {len(set(o2n.values()))} of {len(tree)}; the other {len(tree) - len(set(o2n.values()))} new rows start empty and fill from DIA's own filing through `dia-map.json`.\n")
open(OUT + 'appendix-c-old-to-new.md', 'w', encoding='utf8').write('\n'.join(C))
json.dump(o2n, open(OUT + 'old-to-new.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)

# ---------------------------------------------------------------- collisions
S = []
S.append('## Slugs in both trees\n')
S.append('Ids are the uuidv5 of the slug, so each slug below names **one row** that the current tree and the new tree '
         'both describe. The migration updates that row in place rather than inserting a new one, and must handle '
         'the level and parent changes flagged here.\n')
S.append('| slug | current level / parent | new level / parent | flag | current maps to |')
S.append('| --- | --- | --- | --- | --- |')
oldmap = {o[0]: o for o in old}
both = [s for s in oldmap if s in node]
flags = {}
for s in both:
    o = oldmap[s]
    n = node[s]
    nl = 'root' if n['parentSlug'] is None else 'leaf'
    f = []
    if o[1] != nl:
        f.append(f'**LEVEL CHANGE: {o[1]} becomes {nl}**')
    elif o[2] != n['parentSlug']:
        f.append('parent changes')
    else:
        f.append('unchanged')
    flags[s] = f
    S.append(f"| `{s}` | {o[1]}{' / `' + o[2] + '`' if o[2] else ''} | {nl}{' / `' + n['parentSlug'] + '`' if n['parentSlug'] else ''} | {'; '.join(f)} | `{o2n[s]}` |")
S.append('')
S.append('What each flag asks of the migration:\n')
S.append('- **Leaf becomes root** (`vegetables`): the current leaf holding every fresh vegetable product becomes the root Verduras. '
         'Its products must be moved to a leaf (Appendix C sends them to `uncategorised`, since no DIA leaf is vegetables in general) **before** the row turns into a root, '
         'because a product may only sit on a leaf; and anything that names it as a leaf (shop sections, the reference products in '
         '`mercadona.ts`, and the specs and fakes that use the slug) now names a root. Its name changes from "Verduras y hortalizas" to "Verduras".')
S.append('- **Parent changes** (`pork`, `milk`, `eggs`, `cereals`, `water`): the row keeps its id and products; only `parentId`, `position` and the name are rewritten.')
S.append('- **Unchanged level and parent** (`fish-and-seafood`, `bakery`, `pets`, `other`, `uncategorised`): name and position rewrites only. '
         'Their current leaves all move away, so each of these roots is emptied of its old children and refilled with DIA\'s.')
S.append('')
S.append('### Current rows with no new row\n')
S.append('`frozen` (current root Congelados / Frozen) is **only a current row**. DIA\'s leaf L2249 Congelado, whose English slug is also `frozen`, '
         'takes `fish-and-seafood-frozen` under the extended collision rule (a new leaf equal to a current row of another level takes the parent root prefix), '
         'so the id of `frozen` is never reused. The migration moves its five children (Appendix C), repoints every shop section that names it to '
         '`frozen-foods-and-ice-cream` (`old-to-new.json`), then deletes the row. Every other current slug not in the table above also ends with no new row '
         'and is handled the same way: remap, then delete.\n')
S.append('The rule was also checked the other way round: `vegetables` is the only new root equal to a current leaf, and it keeps its slug by decision.\n')
S.append('Near misses that are **different rows** (different slug, so a new id) and are easy to confuse in review: '
         '`fruit` / `fruits`, `cheese` / `cheeses`, `meat` / `meats`, `yogurts-and-desserts` (current leaf) / `yoghurts-and-desserts` (new root) / `yogurt-and-desserts` (new leaf under `children`), '
         '`ice-cream` / `ice-creams-and-ice`, `pizzas` / `pizzas-and-doughs`, `beer` / `beers`, `chocolate-and-sweets` (current leaf) / `chocolates-and-sweets` (new root), '
         '`fish-and-seafood` (root) / `frozen-foods-and-ice-cream-fish-and-seafood` (leaf), `frozen` (current root, deleted) / `fish-and-seafood-frozen` (new leaf).\n')
open(OUT + 'slug-collisions.md', 'w', encoding='utf8').write('\n'.join(S))

print('both', both, flags)
print('cleaned', cleaned)
print('dmap', dmap)
print('split', [s for s in M if 'split:' in M[s][1]])
print('doubt', [s for s in M if 'doubt:' in M[s][1]])
print('brows', brows)
print('unused new', len(tree) - len(set(o2n.values())))
