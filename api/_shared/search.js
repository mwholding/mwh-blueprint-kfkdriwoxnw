// Search over the knowledge base, shared by the browser's search box (api/Search) and the MCP
// `search` tool (api/Mcp) so the two can never drift apart — in particular so neither becomes a
// way around the wiki read gate. Lexical, no vector database: a few thousand pages fit this
// approach, and a vector store would be permanent infrastructure to run.
//
// Adding a second corpus (process docs, a document register, ...) means adding a block here that
// filters by its own permission, and returning it under its own key — never a shared filter.

const { canReadWiki } = require("./access");
const wiki = require("./wikiStore");

const DEFAULT_LIMIT = 8;
const SNIPPET_RADIUS = 80;

// Short excerpt around the first match so a hit shows *why* it matched, not just its title.
function snippet(text, query) {
  const plain = (text ?? "").replace(/\s+/g, " ").trim();
  const at = plain.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return plain.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(plain.length, at + query.length + SNIPPET_RADIUS);
  return (start > 0 ? "…" : "") + plain.slice(start, end) + (end < plain.length ? "…" : "");
}

// Returns { wiki: [...] }, already filtered to what `email` may read (nothing without a wiki
// read grant). Shaped as an object rather than a bare array so another corpus can be added
// without changing either caller.
async function search(email, query, limit = DEFAULT_LIMIT) {
  const q = (query ?? "").trim();
  if (!q) return { wiki: [] };

  let wikiResults = [];
  if (await canReadWiki(email)) {
    const hits = await wiki.listPages(undefined, q);
    wikiResults = hits.slice(0, limit).map((p) => ({
      id: p.id,
      title: p.title,
      folder: p.folder || "",
      snippet: snippet(p.content, q),
    }));
  }

  return { wiki: wikiResults };
}

module.exports = { search, snippet, DEFAULT_LIMIT };
