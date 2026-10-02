# DIA fixtures

Twenty one answers, captured on 2026-10-02. Each file holds **exactly the bytes
that the server sent**. No test in this library uses the network, so these files
are the whole contract with the source. If the JSON changes upstream, a test
fails and the diff shows why.

`statuses.json` records the HTTP status of each answer. The capture tool writes
it. Three answers mean something by their status alone: a `204` accepts a postal
code, and the two `206` answers refuse one.

| File | What it is |
| --- | --- |
| `header-anonymous.json` | `header-data` of a new session. `cart.postal_code` is `28041`, the default for the whole country. |
| `menu.json` | `menu-data`: 29 roots and their leaves, in Spanish, with a "Todo" child per root. |
| `listing-page-1.json`, `listing-page-2.json` | Pages 1 and 2 of Cola (`L2108`), 20 rows each. The names print packs as `12 x 330 ml` and `pack 4 x 2 L`. |
| `listing-last-page.json` | Page 3 of the same leaf, the last page, with 16 rows. |
| `listing-past-end.json` | Page 99 of the same leaf: status 200 and no rows. |
| `listing-weight.json` | Manzanas y peras (`L2032`): rows sold by weight, with `weight_in_grams` and `average_weight`. |
| `listing-club.json`, `listing-multibuy.json` | Page 1 of Agua (`L2107`). It holds two Club Dia rows and two club only multi buy rows. The two files hold the same page. |
| `listing-promotion.json` | Page 1 of Pollo (`L2202`): one promotion for everybody, and rows printed `600 g aprox.`. |
| `check-service-200.json` | `check-service` for `28041`: store `13835`. |
| `check-service-206.txt` | `check-service` for `44200`: status 206 and an empty body, which means no online service. |
| `save-shipping-address-204.txt` | The `PUT` that moves the session to `08001`: status 204 and an empty body. |
| `header-after-put.json` | `header-data` after that `PUT`: `cart.postal_code` is `08001`. |
| `save-shipping-address-206.json` | The `PUT` for `44200`, which is not served: status 206. |
| `header-after-refusal.json` | `header-data` after the refusal. The session keeps `08001`. |
| `store-finder.html` | The store finder page. Its hidden `#gz` input names the current shop file. |
| `stores.json.gz` | The shop file, still a gzip file: 3,238 records, DIA and Clarel. |
| `store-detail-normal.json` | Shop `14126`, Madrid `28004`: Sunday hours differ, and it has home delivery. |
| `store-detail-hub.json` | Shop `13835`, the Madrid hub: `fechaApertura` is `31/12/2026`, so it reads as temporarily closed. |
| `store-detail-leaflet.json` | Shop `1443`, Crevillent: a leaflet, six fresh counters, and no Sunday hours. |

## Why they are whole answers

The parsers must find their fields inside a real answer. A trimmed fixture does
not prove that. So nothing here is trimmed, and **nobody edits a fixture by
hand**.

Refresh them with this command, then commit the diff:

```sh
npx nx run luna-shopper/dia:capture-fixtures
```

The command makes at most 35 requests, one at a time, 750 ms apart. It sends the
browser headers of decision D1 (plan 0174, section 2), because the site refuses
every other client.

Promotions move every week. The capture tool reads page 1 of a fixed list of
leaves until it finds each price kind, so `listing-club.json` and its two
siblings can hold another leaf after a recapture. The tests find their rows by
price kind and never by product. The table of real names is in `size.spec.ts`,
where a recapture cannot rewrite it.
