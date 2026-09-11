# Making it yours

Four files decide how this intranet looks and what it is called. Nothing else names a
colour, a font or a company.

| File | What it controls |
|---|---|
| `assets/brand.css` | colours and fonts, for every page and every self-built app |
| `site.json` | site name, the sentence under the headline, support address |
| `assets/logo.svg` | the logo in the header of every page |
| `assets/favicon.svg` | the browser-tab icon |

Plus one file for identity rather than looks: **`api/_shared/config.js`**. It holds the email
domains that may sign in (`ALLOWED_DOMAINS`), the addresses that administer the intranet
(`ADMIN_EMAILS`), and the organisation name the AI is told about (`ORG_NAME`). Setting
`ADMIN_EMAILS` to your own work address is what makes the first sign-in work: those addresses
hold every permission whatever is stored later, and everyone else is managed in
`/apps/access-admin/` in the browser afterwards. There is no seed script and no first-run
wizard to remember.

## Colours

Open `assets/brand.css`. It has nine values, in two groups.

```css
--brand-accent:#D3181F;        /* your primary colour: logo, H1, buttons, links, focus */
--brand-accent-hover:#C62332;  /* the same hue, a shade darker, for hover and pressed */
--brand-accent-mid:#EE6A6F;    /* a lighter tint, for a second series in a chart */
--brand-accent-tint:#F0DEDC;   /* a very soft wash, for small filled badges */

--brand-ink:#0F0F0F;           /* text */
--brand-mute:#8C7E75;          /* secondary text, captions, labels */
--brand-line:#C4BAB2;          /* hairlines and borders — never text, it fails contrast */
--brand-soft:#F2EEEA;          /* page background, table headers */
--brand-paper:#FFFFFF;         /* cards */
```

Replace the accent with your own and the neutrals with a grey ramp that suits it: warm
greys for a warm accent, cool greys for a cool one. Keep the roles — a light tone for the
page, white for cards, one mid grey for lines, one darker grey for secondary text — and
everything downstream still works, including apps a colleague generates months from now.

**One accent.** The design has exactly one, on purpose: it is what makes twenty small apps
built by different people look like one intranet. A second accent is the fastest way to
lose that.

## Fonts

The default stack is the system font, which looks clean and needs nothing. To use a
corporate typeface:

1. Convert it to `woff2` and put the files in `assets/fonts/`.
2. Declare them with `@font-face` at the bottom of `brand.css` (there is a commented
   example).
3. Put the family first in `--font-sans`.

Self-host them. The Content-Security-Policy on the self-built apps blocks Google Fonts and
every other external host, so a CDN font would load on some pages and silently not on
others.

## Logo

Replace `assets/logo.svg` with your own. SVG is best; a PNG at twice the display size is
fine, in which case rename the file and change the four references:

```bash
grep -rn "assets/logo.svg" --include="*.html" --include="*.jsx" .
```

The header sizes the logo by height (26px on the home page, 16 to 24px in the app
headers), so any sensible aspect ratio works. If your logo needs a light version for a dark
background, add `assets/logo-inverted.svg` and use it in whatever page has a dark header —
none of the pages in the blueprint do.

`assets/favicon.svg` is the tab icon. Keep it a simple mark: it is rendered at 16px.

## Names and wording

`site.json`:

```json
{
  "name": "Your brand",
  "shortName": "Intranet",
  "tagline": "One place for the tools, knowledge and small apps of the company.",
  "langdockUrl": "https://app.langdock.com/",
  "supportContact": "digital@example.com"
}
```

`name` is the headline and the browser title, `shortName` the small label next to the logo,
`supportContact` the address in the footer.

Two more places carry wording rather than data:

- **`api/_shared/config.js` → `ORG_NAME`** is what a language model is told: "this app is
  hosted on <ORG_NAME>'s own infrastructure and is only reachable after single sign-on".
  It is part of why the model builds the tool instead of refusing on data-protection
  grounds, so set it to the real company name.
- **`api/_shared/userAppTools.js` → `AUTHOR_CONTRACT`** is the design brief every generated
  app is written against. If you change the design system, change that text too, or apps
  will keep being generated against the old rules. It is the only place the model learns
  them.

## Tiles on the home page

`apps/apps.json` is a plain list:

```json
{ "name": "Knowledge base", "desc": "One sentence.", "url": "/apps/wiki/" }
```

Add `"status": "planned"` for a greyed-out placeholder. Nothing about access belongs in
this file: the home page shows a tile only when the visitor holds the role named by the
path, and the "All staff" or "Restricted" label comes from access management. An external
`https://` URL is always shown.

## What not to change without deciding to

- **Square corners, hairlines, no shadows.** These are cheap to change and expensive to
  change back: the app kit, the generated apps and the existing pages all assume them.
- **Red for destructive actions.** If your accent is red, a delete button and a primary
  button look alike. Pick a distinct tone for destructive actions in that case, and use it
  consistently.
- **The uppercase rule.** Only the small `.eyebrow` label is uppercase. Uppercase headlines
  break the layout at small widths in a way nobody notices until it is on someone's phone.
