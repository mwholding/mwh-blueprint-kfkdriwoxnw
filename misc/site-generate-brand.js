// Writes assets/brand.css from the "brand" section of site.config.json: one accent colour and
// one font stack. Everything else is derived here — the accent's hover, light and tint shades —
// or a fixed neutral default (the greys, the success green). Runs in the deploy workflow before
// every upload. Never edit brand.css by hand; it is overwritten.
//
//   node misc/site-generate-brand.js           # write assets/brand.css
//   node misc/site-generate-brand.js --check   # exit 1 if assets/brand.css is out of date

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG = path.join(ROOT, "site.config.json");
const OUT = path.join(ROOT, "assets", "brand.css");

// Neutral greys and the success colour: not part of a brand, so not configurable.
const FIXED = {
  "--brand-ink": ["#18181B", "text"],
  "--brand-mute": ["#5B5B66", "secondary text, captions, labels"],
  "--brand-line": ["#E4E4E7", "hairlines and borders, never text"],
  "--brand-soft": ["#F7F7F8", "page background, table headers"],
  "--brand-paper": ["#FFFFFF", "cards and raised surfaces"],
  "--brand-ok": ["#166534", "success: saved, added, done"],
  "--brand-ok-tint": ["#DCFCE7", "a soft wash of the success colour"],
};
const DEFAULT_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const luminance = (h) => rgb(h).reduce((s, v, i) => s + [0.2126, 0.7152, 0.0722][i] * v / 255, 0);

function build(brand) {
  const accent = String(brand.accent || "");
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new Error(`brand.accent must be a colour like #18181B, got "${accent}"`);
  const font = String(brand.font || DEFAULT_FONT);
  if (!/^[,.\-\w\s"']+$/.test(font)) throw new Error("brand.font may only contain font names, commas and quotes");
  // Hover: lighter for a dark accent (a darker near-black would not show), darker otherwise.
  const hover = luminance(accent) < 0.2 ? mix(accent, "#FFFFFF", 0.18) : mix(accent, "#000000", 0.15);
  const vars = {
    "--brand-accent": [accent.toUpperCase(), "the one accent: primary buttons, links, focus"],
    "--brand-accent-hover": [hover, "hover and pressed"],
    "--brand-accent-mid": [mix(accent, "#FFFFFF", 0.6), "a light shade: a second chart series, placeholders"],
    "--brand-accent-tint": [mix(accent, "#FFFFFF", 0.94), "a very soft wash: badges, selected states"],
    ...FIXED,
  };
  const lines = [
    "/* GENERATED from site.config.json by misc/site-generate-brand.js — do not edit by hand. */",
    ":root{",
    ...Object.entries(vars).map(([name, [value, note]]) => `  ${name}:${value}; /* ${note} */`),
    `  --font-sans:${font};`,
    `  --font-condensed:${font};`,
    '  --font-accent:ui-serif, Georgia, "Times New Roman", serif;',
    "}",
    "",
  ];
  return lines.join("\n");
}

function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const css = build(config.brand || {});
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (css === current) return console.log("assets/brand.css is up to date.");
  if (process.argv.includes("--check")) {
    console.error("--check: assets/brand.css is out of date. Run node misc/site-generate-brand.js");
    process.exit(1);
  }
  fs.writeFileSync(OUT, css);
  console.log("Wrote assets/brand.css from site.config.json.");
}

module.exports = { build };

if (require.main === module) main();
