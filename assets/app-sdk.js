/* App SDK for user apps (the ones colleagues build by describing them in a Langdock chat).
   Optional but recommended — link AFTER app-kit.css:
     <script src="/assets/app-sdk.js"></script>
   Exposes window.APP: the signed-in identity, the app's own key-value + file store, an AI
   helper, and a few UI helpers (safe Markdown, tables, CSV download, a simple bar chart).
   Everything is same-origin, so it works under the app Content-Security-Policy.

   The tool description in api/_shared/userAppTools.js is what teaches the model this exists —
   change one and change the other, or apps will be generated against an SDK that has moved. */
(function () {
  "use strict";

  // The app id is the slug in the serving URL (/api/a/<id>/…); ?app= is the local/testing form.
  var APP_ID =
    (location.pathname.match(/\/api\/a\/([^/]+)\//) || [])[1] ||
    new URLSearchParams(location.search).get("app") || "";
  var DATA = "/api/AppData?app=" + encodeURIComponent(APP_ID);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function asJson(res) {
    var body = await res.text();
    var data = body ? JSON.parse(body) : null;
    if (!res.ok) throw new Error((data && data.error) || res.status + " " + res.statusText);
    return data;
  }

  // ---- identity -----------------------------------------------------------
  var _me = null;
  async function me() {
    if (_me) return _me;
    try {
      var r = await fetch("/.auth/me");
      var d = await r.json();
      var p = d && d.clientPrincipal;
      _me = p ? { email: (p.userDetails || "").toLowerCase(), roles: p.userRoles || [], raw: p } : { email: "", roles: [] };
    } catch (e) {
      _me = { email: "", roles: [] };
    }
    return _me;
  }

  // ---- data store (shared per app; see limits in CLAUDE.md) ---------------
  var data = {
    async list() { return (await asJson(await fetch(DATA))).keys || []; },
    async get(key) {
      var r = await fetch(DATA + "&key=" + encodeURIComponent(key));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("read failed: " + r.status);
      return await r.text();
    },
    async getJSON(key) {
      var t = await this.get(key);
      if (t == null) return null;
      try { return JSON.parse(t); } catch (e) { return null; }
    },
    async set(key, value) {
      var isObj = value !== null && typeof value === "object";
      return asJson(await fetch(DATA + "&key=" + encodeURIComponent(key), {
        method: "PUT",
        headers: { "Content-Type": isObj ? "application/json" : "text/plain" },
        body: isObj ? JSON.stringify(value) : String(value),
      }));
    },
    async del(key) { return asJson(await fetch(DATA + "&key=" + encodeURIComponent(key), { method: "DELETE" })); },
    // Store a PDF / image / Office file (Blob or File). Returns { key, size, contentType }.
    async putFile(key, blob) {
      var buf = new Uint8Array(await blob.arrayBuffer());
      var bin = "";
      for (var i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return asJson(await fetch(DATA + "&key=" + encodeURIComponent(key) + "&kind=file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: blob.type || "application/octet-stream", base64: btoa(bin) }),
      }));
    },
    // Same-origin URL for a stored file — use in <img src>, <a href download>, or <iframe> (PDF).
    fileUrl(key) { return DATA + "&key=" + encodeURIComponent(key); },
  };

  // ---- AI (server-side, keyless; default model gpt-5.6-terra) -------------
  async function ai(prompt, opts) {
    opts = opts || {};
    var payload = { system: opts.system, maxTokens: opts.maxTokens, temperature: opts.temperature, json: !!opts.json };
    if (Array.isArray(opts.messages)) payload.messages = opts.messages;
    else payload.prompt = prompt;
    var d = await asJson(await fetch("/api/AppAI?app=" + encodeURIComponent(APP_ID), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }));
    return d.text;
  }
  async function aiJSON(prompt, opts) {
    var t = await ai(prompt, Object.assign({ json: true }, opts || {}));
    t = String(t).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(t);
  }

  // ---- UI helpers ---------------------------------------------------------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "style") n.style.cssText = attrs[k];
      else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (Array.isArray(children) ? children : children == null ? [] : [children]).forEach(function (c) {
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function toast(msg, ms) {
    var t = el("div", { style: "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--brand-ink,#0F0F0F);color:#fff;padding:10px 16px;font-size:14px;z-index:9999;max-width:90vw" }, String(msg));
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2400);
  }

  // Escape-first Markdown (headings, bold, italic, code, safe links, lists). Never raw HTML.
  function renderMarkdown(md) {
    var lines = String(md == null ? "" : md).split("\n"), out = [], list = null;
    function inline(s) {
      s = esc(s)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
      return s;
    }
    function closeList() { if (list) { out.push("</" + list + ">"); list = null; } }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, "");
      var h = /^(#{1,4})\s+(.*)$/.exec(line);
      var ul = /^[-*]\s+(.*)$/.exec(line);
      var ol = /^\d+\.\s+(.*)$/.exec(line);
      if (h) { closeList(); var lvl = Math.min(4, h[1].length); out.push("<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">"); }
      else if (ul) { if (list !== "ul") { closeList(); list = "ul"; out.push("<ul>"); } out.push("<li>" + inline(ul[1]) + "</li>"); }
      else if (ol) { if (list !== "ol") { closeList(); list = "ol"; out.push("<ol>"); } out.push("<li>" + inline(ol[1]) + "</li>"); }
      else if (!line.trim()) { closeList(); }
      else { closeList(); out.push("<p>" + inline(line) + "</p>"); }
    });
    closeList();
    return out.join("\n");
  }

  // rows: array of objects; columns: [{key,label}] or array of keys. Returns an HTMLTableElement.
  function table(rows, columns) {
    rows = rows || [];
    var cols = (columns && columns.length ? columns : Object.keys(rows[0] || {})).map(function (c) {
      return typeof c === "string" ? { key: c, label: c } : c;
    });
    var thead = "<thead><tr>" + cols.map(function (c) { return "<th>" + esc(c.label) + "</th>"; }).join("") + "</tr></thead>";
    var tbody = "<tbody>" + rows.map(function (r) {
      return "<tr>" + cols.map(function (c) { return "<td>" + esc(r[c.key]) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody>";
    var wrap = el("table");
    wrap.innerHTML = thead + tbody; // all cell content escaped above
    return wrap;
  }

  function csv(rows, filename) {
    rows = rows || [];
    var cols = Object.keys(rows[0] || {});
    var cell = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var text = [cols.join(",")].concat(rows.map(function (r) { return cols.map(function (c) { return cell(r[c]); }).join(","); })).join("\n");
    var url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    var a = el("a", { href: url, download: filename || "export.csv" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // data: [{label, value}]. Renders a flat, single-hue SVG bar chart into `container`.
  function barChart(container, data, opts) {
    opts = opts || {};
    var node = typeof container === "string" ? document.querySelector(container) : container;
    if (!node) return;
    var max = Math.max.apply(null, data.map(function (d) { return Number(d.value) || 0; }).concat([0])) || 1;
    var W = opts.width || node.clientWidth || 640, rowH = 30, gap = 8, padL = 140, padR = 56;
    var H = data.length * (rowH + gap) + gap;
    var accent = getComputedStyle(document.documentElement).getPropertyValue("--brand-accent").trim() || "#D3181F";
    var css = getComputedStyle(document.documentElement);
    var ink = css.getPropertyValue("--brand-ink").trim() || "#0F0F0F";
    var stone = css.getPropertyValue("--brand-mute").trim() || "#8C7E75";
    var bars = data.map(function (d, i) {
      var y = gap + i * (rowH + gap), v = Number(d.value) || 0, w = Math.round((W - padL - padR) * v / max);
      return (
        '<text x="' + (padL - 10) + '" y="' + (y + rowH / 2 + 4) + '" text-anchor="end" font-size="13" fill="' + ink + '">' + esc(d.label) + "</text>" +
        '<rect x="' + padL + '" y="' + y + '" width="' + Math.max(0, w) + '" height="' + rowH + '" fill="' + accent + '"></rect>' +
        '<text x="' + (padL + Math.max(0, w) + 8) + '" y="' + (y + rowH / 2 + 4) + '" font-size="13" fill="' + stone + '">' + esc(opts.format ? opts.format(v) : v) + "</text>"
      );
    }).join("");
    node.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" font-family="var(--font-sans, sans-serif)" role="img">' + bars + "</svg>";
  }

  window.APP = { appId: APP_ID, me: me, data: data, ai: ai, aiJSON: aiJSON, el: el, esc: esc, toast: toast, renderMarkdown: renderMarkdown, table: table, csv: csv, barChart: barChart };
})();
