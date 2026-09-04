# 0012 (backlog) Fetching a leaflet nobody links to

> **Status: backlog. Not scheduled for development.**

Plan `0083` reads a leaflet PDF and turns it into an import document. It does not obtain the PDF.
An admin downloads the file and uploads it, once a month per chain.

This plan is the other half: the harvester finds the current leaflet by itself and fetches it.
It is parked, because the evidence below says the work is a browser in the harvester image and a
scraper against a third party viewer that changes its addresses, in exchange for saving one
download a month.

Everything here was measured against Deza on 2026-09-04. It is written down so that whoever picks
this up starts from facts rather than from the assumption that a PDF has a URL.

## 1. The leaflet has no address

`www.dezacalidad.es/ofertas-folletos/` and `www.dezacalidad.es/folleto-deza/` publish the leaflet.
Neither page contains a link to a PDF.

What the second page does contain, in its served HTML, is one iframe:

```html
<iframe src="https://d3ms8mre5rhtvu.cloudfront.net?hash=Q0M2Nzg2ODhCN0EraGpscjVmanh1Mw=="
        width="100%" height="480" seamless="seamless" scrolling="no" frameborder="0"
        allowfullscreen allow="autoplay; clipboard-read; clipboard-write">
```

The hash is base64. It decodes to `CC678688B7A+hjlr5fjxu3`, which is a Flipsnack book identifier.
Flipsnack is a commercial flipbook host, and the PDF this work started from carries
`"creator": "Flipsnack"` and `"producer": "Flipsnack"` in its metadata, with
`"author": "Supermercados Deza"`.

Fetching that CloudFront URL returns a JavaScript application, not a document. Its HTML references
`app.flipsnack.com`, `auth.flipsnack.com`, `content-private.flipsnack.com/authorization` and a set
of CloudFront distributions. Nothing in it is the leaflet.

## 2. The slugs are not derivable

Deza also publishes through a Flipsnack custom domain, `folleto.dezacalidad.es`, at
`<slug>/full-view.html`. The slugs found in a search index:

```
folleto-deza-enefeb        folleto-deza-julio        folleto-deza-octubre
folleto-noviembre          folleto-deza-junio-2024   prueba-medida
```

Three naming schemes and one that reads like a test page left in public. **A scraper cannot
compute this month's slug from the date.** It has to read whichever page links to it.

`https://folleto.dezacalidad.es/` is that index, and fetching it returns 9 KB of JavaScript shell
with no leaflet links in the markup. So the index needs rendering too.

## 3. What robots.txt permits

Both hosts were checked.

**`www.dezacalidad.es`** allows everything except the WordPress admin:

```
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Sitemap: https://www.dezacalidad.es/wp-sitemap.xml
```

Reading the page that carries the iframe is therefore permitted, and plan `0038` section 8.1's
politeness rules cover how.

**`folleto.dezacalidad.es`**, which is Flipsnack, disallows the path a downloader wants:

```
User-agent: *
Disallow: /admin/
Disallow: /api/
Disallow: /app/
Disallow: /flip-preview/
...
```

`/api/` is exactly where a flipbook's pages or its source document would be requested from. Plan
`0038` section 8.1 set the rule that this project obeys robots.txt as a matter of policy and not
only of law. **So the Flipsnack API is closed to us**, and what remains is the rendered viewer,
which is a canvas of page images rather than a PDF.

## 4. So what the work actually is

1. Fetch `www.dezacalidad.es/folleto-deza/`, which is permitted and cheap, and read the iframe's
   hash out of the markup. That part is a regular expression and needs nothing new.
2. Decide the hash changed since last time, which is the signal that a new leaflet is out. This is
   the one genuinely useful piece, and it is small.
3. Obtain a document from a viewer that does not offer one over a permitted path. This is where
   the cost is. The options are a headless browser driving the viewer and capturing its page
   images, or a permitted export the site may not expose.

Step 3 puts **Chromium in the harvester image**, which the service's own Dockerfile currently
excludes on purpose, and makes the harvester depend on the internal behaviour of a third party
viewer that has no contract with us.

## 5. Why it is parked

- **The saving is one download a month, per chain.** Deza publishes monthly. Two leaflets counting
  SuperCash.
- **The cost is permanent.** A browser in the image is paid on every build, every pull and every
  deploy, and a scraper against a viewer we do not control is paid every time that viewer changes.
- **Step 3 is the fragile part and step 2 is the valuable part.** They can be separated, which is
  section 6.
- Plan `0083` already refuses to fetch, and states this backlog number as the reason.

## 6. The cheap half, if it is ever wanted

Steps 1 and 2 are worth building without step 3, and they need no browser.

A small poller reads the published page on a schedule, extracts the iframe hash, and compares it
with the hash recorded for that chain. When it changes, it **notifies the admin that a new leaflet
is out** and does nothing else. The admin downloads the file and uploads it to plan `0083`, which
is what happens today, except that nobody has to remember to look.

That is a permitted fetch of one small HTML page, a string comparison and a notification. It
removes the part of the manual process that actually fails, which is noticing, and leaves the part
that works, which is a person downloading a file.

**If this backlog item is ever picked up, section 6 is the thing to build, and section 4 step 3 is
the thing to argue about first.**

## 7. What is unknown

Written down because a reader will otherwise assume it was checked.

- **Whether the iframe hash is stable for one leaflet and changes for the next.** One sample was
  observed. Section 6 depends on this being true, and it must be confirmed across two leaflets
  before anything is built on it.
- **Whether Flipsnack offers a permitted download for this account.** Some publishers enable a
  download button. If Deza's is enabled, step 3 may reduce to a permitted fetch, and this whole
  item becomes small.
- **Whether the other chains publish the same way.** El Jamon was not checked. A chain that puts
  a plain PDF at a stable URL needs none of this.
