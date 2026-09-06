# LIDL fixtures

Captured from the live site on 2026-09-06 by
`npx nx run luna-shopper/lidl:capture-fixtures`, and **never hand edited**. A
fixture is the response as served. A test therefore asserts on what the source
sent, rather than on what the normalizer understood.

For the index and the store service that is the JSON body. For a product page it
is the flat array inside the page's `__NUXT_DATA__` tag. The page has no JSON
endpoint behind it, and that tag is the whole input.

| File                             | The case it pins                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `search-page.json`               | one page of the in-store index, holding grocery rows beside bazar rows, so section 5's filter has both  |
| `product-single-price.json`      | an EAN-13, one priced region group, and a second group the chain publishes no price for                |
| `product-two-region-prices.json` | two region groups at two different prices: 51 regions at one, 8 at the other                            |
| `product-unpriced.json`          | in the window with no current price in any region at all, which 21 of the week's products look like     |
| `product-short-code.json`        | an eight digit code in `eans`, which is LIDL's own weight item number and is never written as an EAN    |
| `store-page.json`                | five shops, each naming its price region, with two of them sharing one                                 |

## Two of these are not grocery, on purpose

`product-two-region-prices.json` is a cool box from the weekly bazar. **No
grocery product published two different prices in the week this was captured.**
That is exactly why the fixture is here. The format allows a price per region,
and one week of agreement is not the source. A model that collapsed the regions
has nowhere to store the week LIDL prices one of them on its own.

`product-single-price.json` is a scented candle that LIDL files under `Food`. Its
need world path is `Vivir y amueblar/Decoración`, so it also pins the fallback.
The chain's own tagging is noisy, and a run does not correct it.

## Re-capturing

The assortment is a rolling window. Every product named here leaves in a week or
two, and the capture then fails by name. **Pick a new product for that case
rather than dropping the case.** The shapes outlive any week's assortment. The
products do not. The addresses are in `tools/capture-fixtures.ts`.
