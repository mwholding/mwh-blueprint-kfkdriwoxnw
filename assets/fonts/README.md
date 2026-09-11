Put self-hosted webfont files here (woff2 is the right format) and declare them with
@font-face in ../brand.css. They must be self-hosted: the Content-Security-Policy on
user apps blocks Google Fonts and every other external host.

The blueprint ships no font files on purpose — corporate typefaces are licensed, and a
missing licence is not something to inherit from a template. Until you add one, the site
uses the system font stack, which looks clean and costs nothing.
