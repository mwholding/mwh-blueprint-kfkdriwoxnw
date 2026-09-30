/* views.jsx — three ways into the same data:
   Groups (a group's members + what it grants), Apps (who can get into one app),
   Users (one person's groups + what that adds up to). */

/* ---------- in-page dialogs, instead of the browser's prompt/confirm/alert ----------
   askDialog({ title, message?, fields?: [{ name, label, value?, placeholder?, help? }],
               validate?(values) -> error text, confirmLabel?, danger? })
   resolves to the field values (or true without fields) on confirm, null on cancel. */
const dialogBus = { show: null };
const askDialog = (opts) => new Promise((resolve) => dialogBus.show(Object.assign({}, opts, { resolve })));
const confirmDialog = (title, message, confirmLabel) => askDialog({ title, message, confirmLabel, danger: true });

function DialogHost() {
  const [d, setD] = useState(null);
  const [values, setValues] = useState({});
  const [error, setError] = useState("");
  const first = useRef(null);
  useEffect(() => {
    dialogBus.show = (opts) => {
      setValues(Object.fromEntries((opts.fields || []).map((f) => [f.name, f.value || ""])));
      setError("");
      setD(opts);
    };
  }, []);
  useEffect(() => { if (d && first.current) first.current.focus(); }, [d]);
  if (!d) return null;
  const close = (result) => { d.resolve(result); setD(null); };
  const submit = (e) => {
    e.preventDefault();
    const err = d.validate ? d.validate(values) : "";
    if (err) { setError(err); return; }
    close(d.fields ? values : true);
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null); }}
      onKeyDown={(e) => { if (e.key === "Escape") close(null); }}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onSubmit={submit}>
        <h2 id="dialog-title">{d.title}</h2>
        {d.message && <p className="dialog-msg">{d.message}</p>}
        {(d.fields || []).map((f, i) => (
          <label key={f.name} className="dialog-field">
            <span>{f.label}</span>
            <input ref={i === 0 ? first : null} type="text" value={values[f.name] || ""} placeholder={f.placeholder || ""}
              onChange={(e) => { setValues(Object.assign({}, values, { [f.name]: e.target.value })); setError(""); }} />
            {f.help && <small>{typeof f.help === "function" ? f.help(values) : f.help}</small>}
          </label>
        ))}
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" ref={d.fields ? null : first} onClick={() => close(null)}>Cancel</button>
          <button type="submit" className={"btn " + (d.danger ? "danger-solid" : "primary")}>{d.confirmLabel || "OK"}</button>
        </div>
      </form>
    </div>
  );
}

/* On a phone the list and the detail take turns; this is the way back to the list. */
function BackToList({ onClick, label }) {
  return <button className="back-to-list" onClick={onClick}>&larr; {label}</button>;
}

/* ---------- small shared pieces ---------- */

function Chip({ label, title, auto, onRemove }) {
  return (
    <span className={"chip" + (auto ? " auto" : "")} title={title}>
      {label}
      {onRemove && <button onClick={onRemove} aria-label={"Remove " + label}>&times;</button>}
    </span>
  );
}

function Badge({ tier }) {
  if (tier === null || tier === undefined) return null;
  const name = tierName(tier);
  return <span className={"badge " + name}>{levelLabel(name)}</span>;
}

/* text entry + Add button (emails, domains, free-form names) */
function AddText({ placeholder, onAdd, label }) {
  const [v, setV] = useState("");
  const submit = () => {
    const t = v.trim();
    if (!t) return;
    onAdd(t);
    setV("");
  };
  return (
    <div className="add-row">
      <input
        type="text" value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
      />
      <button className="btn" onClick={submit}>{label}</button>
    </div>
  );
}

/* pick from a fixed list + Add button (group names) */
function AddPick({ options, onAdd, label, placeholder }) {
  const [v, setV] = useState("");
  if (!options.length) return null;
  return (
    <div className="add-row">
      <select value={v} onChange={(e) => setV(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button className="btn" disabled={!v} onClick={() => { onAdd(v); setV(""); }}>{label}</button>
    </div>
  );
}

function Rail({ title, help, items, selected, onSelect, search, onSearch, action, sections }) {
  // `sections`: optional [id, heading] pairs; items carry `section`. Empty sections are left out.
  const groups = sections
    ? sections.map(([id, heading]) => ({ heading, items: items.filter((it) => it.section === id) })).filter((g) => g.items.length)
    : [{ heading: null, items }];
  return (
    <div className="rail">
      <div className="rail-head">
        <h2>{title}</h2>
        <p>{help}</p>
      </div>
      <div className="rail-tools">
        <input type="text" placeholder="Search…" value={search} onChange={(e) => onSearch(e.target.value)} />
        {action}
      </div>
      <div className="rail-list">
        {items.length === 0 && <div className="empty" style={{ padding: "20px 16px", fontSize: 13 }}>{search ? "Nothing matches." : "Nothing here yet."}</div>}
        {groups.map((g) => (
          <div key={g.heading || "all"}>
            {g.heading && <div className="rail-section">{g.heading}</div>}
            {g.items.map((it) => (
              <button
                key={it.id}
                className={"rail-item" + (it.id === selected ? " active" : "")}
                aria-current={it.id === selected ? "true" : undefined}
                onClick={() => onSelect(it.id)}
              >
                <span className="n">{it.name}</span>
                <span className="m">{it.meta}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* keep a selection valid as the underlying list changes (rename, delete, first load) */
function useSelection(ids) {
  const [sel, setSel] = useState(null);
  useEffect(() => {
    if (sel && ids.indexOf(sel) !== -1) return;
    setSel(ids[0] || null);
  }, [ids.join(" "), sel]);
  return [sel, setSel];
}

/* ---------- one editable permission ---------- */
function PermissionRow({ perm, onChange, onRemove, apps }) {
  const appOptions = appList(apps).map((a) => ({ id: a.id, label: a.label || a.id }));
  if (perm.app && !appOptions.some((a) => a.id === perm.app)) {
    appOptions.push({ id: perm.app, label: perm.app + " (not registered)" });
  }
  const levelOptions = LEVELS.slice();
  if (perm.action && !levelOptions.some((l) => l.id === perm.action)) {
    levelOptions.push({ id: perm.action, label: perm.action + " (custom)" });
  }

  const scope = perm.scope || {};
  const unit = scope.unit || "";
  // Scopes other than unit aren't editable here — shown so they can't be silently lost.
  const otherScope = Object.keys(scope).filter((k) => k !== "unit");

  const setUnit = (val) => {
    const next = Object.assign({}, scope);
    if (val) next.unit = val; else delete next.unit;
    onChange(Object.assign({}, perm, { scope: Object.keys(next).length ? next : undefined }));
  };

  return (
    <div className="perm">
      <select
        className="app-sel" value={perm.app || ""}
        onChange={(e) => onChange(Object.assign({}, perm, { app: e.target.value }))}
      >
        <option value="">Choose an app…</option>
        {appOptions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>

      <select
        className="lvl-sel" value={perm.action || "read"}
        onChange={(e) => onChange(Object.assign({}, perm, { action: e.target.value }))}
      >
        {levelOptions.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>

      {SCOPED_APPS.includes(perm.app) && (
        <select className="unit-sel" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="">All units</option>
          {UNITS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      )}

      {otherScope.map((k) => <span key={k} className="odd-scope">{k}={scope[k]}</span>)}

      <span className="grow" />
      <button className="btn danger" onClick={onRemove}>Remove</button>
    </div>
  );
}

function PermissionList({ permissions, onChange, apps }) {
  const set = (i, next) => {
    const arr = permissions.slice();
    arr[i] = next;
    onChange(arr);
  };
  const remove = (i) => {
    const arr = permissions.slice();
    arr.splice(i, 1);
    onChange(arr);
  };
  return (
    <div>
      {permissions.length === 0 && <p className="note" style={{ margin: "0 0 10px" }}>This group grants nothing yet.</p>}
      {permissions.map((p, i) => (
        <PermissionRow key={i} perm={p} onChange={(n) => set(i, n)} onRemove={() => remove(i)} apps={apps} />
      ))}
      <button className="btn" onClick={() => onChange([...permissions, { app: "", action: "read" }])}>
        + Add permission
      </button>
    </div>
  );
}

/* ---------- Groups ---------- */
function GroupsView({ store }) {
  const { groups, users } = store.data;
  const [q, setQ] = useState("");
  const names = groupNames(groups);
  const [sel, setSel] = useSelection(names);
  const [open, setOpen] = useState(false);
  const pick = (id) => { setSel(id); setOpen(true); };

  const items = names
    .filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()) || (groups[n].label || "").toLowerCase().includes(q.toLowerCase()))
    .map((n) => {
      const g = groups[n];
      const mem = membersOf(n, users).length;
      const dom = (g.domains || []).length;
      const parts = [];
      if (mem) parts.push(mem + (mem === 1 ? " member" : " members"));
      if (dom) parts.push(dom + (dom === 1 ? " domain" : " domains"));
      if (!parts.length) parts.push("no members");
      return { id: n, name: g.label || n, meta: parts.join(" · ") };
    });

  const addGroup = async () => {
    const v = await askDialog({
      title: "New group",
      fields: [{ name: "label", label: "Name", placeholder: "e.g. Finance team", help: (x) => (slugify(x.label) ? "Internal key: " + slugify(x.label) : "") }],
      validate: (x) => (!slugify(x.label) ? "Give the group a name." : groups[slugify(x.label)] ? "A group with that key already exists." : ""),
      confirmLabel: "Create group",
    });
    if (!v) return;
    const key = slugify(v.label);
    store.setGroups((g) => Object.assign({}, g, { [key]: { label: v.label.trim(), domains: [], permissions: [] } }));
    pick(key);
  };

  return (
    <div className={"split" + (open ? " show-detail" : "")}>
      <Rail
        title="Groups" help="A group bundles app permissions. People join by name, or automatically by email domain."
        items={items} selected={sel} onSelect={pick} search={q} onSearch={setQ}
        action={<button className="btn primary" onClick={addGroup}>New</button>}
      />
      <div className="detail">
        <BackToList label="All groups" onClick={() => setOpen(false)} />
        {!sel ? <div className="empty">No groups yet. Create one to get started.</div>
              : <GroupDetail key={sel} name={sel} store={store} onSelect={setSel} />}
      </div>
    </div>
  );
}

function GroupDetail({ name, store, onSelect }) {
  const { groups, users } = store.data;
  const group = groups[name];
  if (!group) return <div className="empty">That group no longer exists.</div>;

  const members = membersOf(name, users);
  const patch = (p) => store.setGroups((g) => Object.assign({}, g, { [name]: Object.assign({}, g[name], p) }));

  const renameKey = async () => {
    const v = await askDialog({
      title: "Rename internal key",
      message: "The key is how permissions and members refer to the group. Members move along with it.",
      fields: [{ name: "key", label: "Internal key", value: name }],
      validate: (x) => {
        const k = slugify(x.key);
        return !k ? "The key cannot be empty." : k !== name && groups[k] ? "A group with that key already exists." : "";
      },
      confirmLabel: "Rename",
    });
    const key = v && slugify(v.key);
    if (!key || key === name) return;
    store.setGroups((g) => {
      const copy = Object.assign({}, g);
      copy[key] = copy[name];
      delete copy[name];
      return copy;
    });
    store.setUsers((u) => {
      const out = {};
      Object.keys(u).forEach((e) => { out[e] = u[e].map((n) => (n === name ? key : n)); });
      return out;
    });
    onSelect(key);
  };

  const remove = async () => {
    if (!(await confirmDialog("Delete group", `Delete "${group.label || name}"? Everyone in it loses what it granted.`, "Delete group"))) return;
    store.setGroups((g) => { const c = Object.assign({}, g); delete c[name]; return c; });
    store.setUsers((u) => {
      const out = {};
      Object.keys(u).forEach((e) => { out[e] = u[e].filter((n) => n !== name); });
      return out;
    });
    onSelect(null);
  };

  return (
    <div className="detail-inner">
      <div className="detail-head">
        <h2>{group.label || name}</h2>
        <span className="key">{name}</span>
      </div>
      <p className="detail-sub">
        {members.length || (group.domains || []).length
          ? "Everyone below gets every permission this group grants."
          : "Nobody is in this group yet, so it grants nothing to anyone."}
      </p>

      <div className="field">
        <h3>Name</h3>
        <input className="wide" type="text" value={group.label || ""}
          onChange={(e) => patch({ label: e.target.value })} placeholder="Shown in this admin panel only" />
      </div>

      <div className="field">
        <h3>Permissions</h3>
        <p className="help">What members of this group may do. Read is included in write, and write in full admin.</p>
        <PermissionList permissions={group.permissions || []} onChange={(permissions) => patch({ permissions })} apps={store.data.apps} />
      </div>

      <div className="field">
        <h3>Members</h3>
        <p className="help">People added here by name.</p>
        <div className="chips">
          {members.length === 0 && <span className="note">None yet.</span>}
          {members.map((e) => (
            <Chip key={e} label={e} onRemove={() => store.setMembership(e, name, false)} />
          ))}
        </div>
        <AddText placeholder="name@company.com" label="Add member"
          onAdd={(e) => store.setMembership(e, name, true)} />
      </div>

      <div className="field">
        <h3>Automatic by email domain</h3>
        <p className="help">
          Anyone signing in from one of these domains is a member automatically — useful when the
          people aren't known by name yet.
        </p>
        <div className="chips">
          {(group.domains || []).length === 0 && <span className="note">None — members are added by name only.</span>}
          {(group.domains || []).map((d) => (
            <Chip key={d} label={d} onRemove={() => patch({ domains: group.domains.filter((x) => x !== d) })} />
          ))}
        </div>
        <AddText placeholder="example.com" label="Add domain"
          onAdd={(d) => patch({ domains: Array.from(new Set([...(group.domains || []), d.toLowerCase()])) })} />
      </div>

      <div className="footer-actions">
        <button className="link" onClick={renameKey}>Rename internal key</button>
        <span className="spacer" />
        <button className="btn danger" onClick={remove}>Delete group</button>
      </div>
    </div>
  );
}

/* Only fires for a registered path that nothing guards — a path outside /apps/ (no rule is
   generated for those) or an app folder that hasn't been deployed yet. Switching an app between
   open and restricted needs no deploy at all, so it never appears here. */
function AppsView({ store }) {
  const { apps, groups } = store.data;
  const [q, setQ] = useState("");
  // The registry, plus any app id a group permission points at. An id in the second set but
  // not the first is a leftover: the permission grants a role nothing guards, so the UI offers
  // to register it.
  const ids = allAppIds(apps, groups);
  const [sel, setSel] = useSelection(ids);
  const [open, setOpen] = useState(false);
  const pick = (id) => { setSel(id); setOpen(true); };
  // No registered path means no page — it is a permission other code checks (an MCP-only
  // capability, say), so "open to everyone" would be nonsense for it.
  const isPageless = (id) => !((apps[id] || {}).path);

  const countFor = (app) =>
    Object.values(groups).reduce((n, g) => n + (g.permissions || []).filter((p) => p.app === app).length, 0);

  const labelFor = (id) => (apps[id] || {}).label || id;

  const items = ids
    .filter((a) => !q || a.toLowerCase().includes(q.toLowerCase()) || labelFor(a).toLowerCase().includes(q.toLowerCase()))
    .map((a) => {
      const entry = apps[a];
      const c = countFor(a);
      let meta;
      const section = a === "intranet" ? "home" : !entry ? "unregistered" : entry.path ? "apps" : "links";
      if (isPageless(a) && entry && entry.url) {
        meta = "link on the home page";
      } else if (isPageless(a)) {
        meta = c ? "permission only · " + c + (c === 1 ? " group" : " groups") : "permission only";
      } else if (!entry) {
        // A permission points at an id nothing registers, so the role it grants opens nothing.
        meta = "not registered";
      } else if (!entry.gated) {
        meta = "open to everyone";
      } else {
        meta = c ? c + (c === 1 ? " group" : " groups") : "restricted, nobody yet";
      }
      return { id: a, name: labelFor(a), meta, section };
    });

  const addApp = async () => {
    const v = await askDialog({
      title: "New app",
      message: "Register an app folder, or a link or permission without a page. It starts restricted: nobody gains access until you decide who gets in.",
      fields: [
        { name: "label", label: "Name", placeholder: "e.g. Contract register",
          help: (x) => (slugify(x.label) ? "Id and role: " + slugify(x.label) + " — the folder must be apps/" + slugify(x.label) + "/" : "") },
        { name: "path", label: "Path to protect", placeholder: "/apps/contract-register/ — or empty for a link or a permission",
          help: "Leave empty for a tile that links elsewhere, or for a permission an app checks itself." },
      ],
      validate: (x) => (!slugify(x.label) ? "Give the app a name." : apps[slugify(x.label)] ? '"' + slugify(x.label) + '" already exists.' : ""),
      confirmLabel: "Register app",
    });
    if (!v) return;
    const id = slugify(v.label);
    store.setApps((a) => Object.assign({}, a, {
      [id]: { label: v.label.trim(), description: "", path: normalisePath(v.path), url: "", gated: true, showOnHome: false, order: 100, status: "" },
    }));
    pick(id);
  };

  return (
    <div className={"split" + (open ? " show-detail" : "")}>
      <Rail
        title="Apps" help="Everything that can be gated, and who gets in. Each entry is also a tile on the home page."
        items={items} selected={sel} onSelect={pick} search={q} onSearch={setQ}
        sections={[["home", "Home page"], ["apps", "Apps"], ["links", "Links and permissions"], ["unregistered", "Not registered"]]}
        action={<button className="btn primary" onClick={addApp}>New</button>}
      />
      <div className="detail">
        <BackToList label="All apps" onClick={() => setOpen(false)} />
        {!sel ? <div className="empty">Nothing registered yet — use New to add an app.</div>
              : <AppDetail key={sel} app={sel} store={store} onSelect={setSel} pageless={isPageless(sel)} />}
      </div>
    </div>
  );
}

function AppDetail({ app, store, onSelect, pageless }) {
  const { apps, groups } = store.data;
  const entry = apps[app];

  const rows = [];
  groupNames(groups).forEach((name) => {
    (groups[name].permissions || []).forEach((p, i) => {
      if (p.app === app) rows.push({ group: name, index: i, perm: p });
    });
  });

  const patch = (p) => store.setApps((a) => Object.assign({}, a, { [app]: Object.assign({}, a[app], p) }));

  // Register a leftover id restricted, with the path an app folder of that name would have.
  // Restricted is the safe direction: opening it is one click here, and until someone does,
  // nobody gains access they did not already have.
  const adopt = () => store.setApps((a) => Object.assign({}, a, {
    [app]: { label: app, description: "", path: "/apps/" + app + "/*", url: "", gated: true, showOnHome: false, order: 100, status: "" },
  }));

  const removeApp = async () => {
    const message = rows.length
      ? `${rows.length} group permission(s) still point at "${app}". They stay, and show as "not registered". Nobody can open the app until it is registered again.`
      : `Remove "${entry.label || app}" from the registry? Nobody can open it until it is registered again.`;
    if (!(await confirmDialog("Remove from registry", message, "Remove"))) return;
    store.setApps((a) => { const c = Object.assign({}, a); delete c[app]; return c; });
    onSelect(null);
  };

  const updatePerm = (groupName, index, next) => {
    store.setGroups((g) => {
      const perms = (g[groupName].permissions || []).slice();
      perms[index] = next;
      return Object.assign({}, g, { [groupName]: Object.assign({}, g[groupName], { permissions: perms }) });
    });
  };
  const removePerm = (groupName, index) => {
    store.setGroups((g) => {
      const perms = (g[groupName].permissions || []).slice();
      perms.splice(index, 1);
      return Object.assign({}, g, { [groupName]: Object.assign({}, g[groupName], { permissions: perms }) });
    });
  };
  const grant = (groupName) => {
    store.setGroups((g) => Object.assign({}, g, {
      [groupName]: Object.assign({}, g[groupName], {
        permissions: [...(g[groupName].permissions || []), { app, action: "read" }],
      }),
    }));
  };

  const ungranted = groupNames(groups)
    .filter((n) => !rows.some((r) => r.group === n))
    .map((n) => ({ id: n, label: groups[n].label || n }));

  if (!entry) {
    return (
      <div className="detail-inner">
        <div className="detail-head">
          <h2>{app}</h2>
          <span className="key">not registered</span>
        </div>
        <p className="detail-sub">
          A group permission points at <strong>{app}</strong>, but nothing is registered under that
          name, so the role it hands out guards nothing. Either register it here, or remove the
          permission from the group.
        </p>
        <button className="btn primary" onClick={adopt}>Add "{app}" to the registry</button>
        <p className="note" style={{ marginTop: 14 }}>
          It is added as restricted. Nobody gains access by registering it — you decide who gets
          in on the next screen.
        </p>
      </div>
    );
  }

  const routeRule = entry.path
    ? JSON.stringify({ route: entry.path, allowedRoles: [app] })
    : null;

  return (
    <div className="detail-inner">
      <div className="detail-head">
        <h2>{entry.label || app}</h2>
        <span className="key">{app}</span>
      </div>
      <p className="detail-sub">Who can get into this, and at what level.</p>

      <div className="field">
        <h3>Name</h3>
        <input className="wide" type="text" value={entry.label || ""}
          onChange={(e) => patch({ label: e.target.value })} placeholder="Shown to admins here" />
      </div>

      <div className="field">
        <h3>Path</h3>
        <p className="help">The URL this protects. Leave empty for a permission with no page of its own (e.g. an MCP-only capability).</p>
        <input className="wide" type="text" value={entry.path || ""}
          onChange={(e) => patch({ path: e.target.value })}
          onBlur={(e) => patch({ path: normalisePath(e.target.value) })}
          placeholder="/apps/board-reports/*" />
      </div>

      {app === "intranet" && (
        <div className={entry.gated ? "banner warn" : "banner muted"} style={{ marginBottom: 20 }}>
          {entry.gated ? (
            <>
              <strong>The intranet is restricted.</strong> Only the groups below are members: the home
              page with all their apps, and the Langdock connection. Everyone else who may sign in is an{" "}
              <strong>app-only guest</strong>: they get the open apps and the apps a group grants them,
              and a user app somebody shares with them.
            </>
          ) : (
            <>
              This is the front door, not one app: <strong>open</strong> means everyone with an allowed
              email domain is a member. Restrict it when the sign-in tenant holds far more people than
              should see the intranet; you can still give those people single apps.
            </>
          )}
        </div>
      )}

      <div className="field">
        <h3>Who may open it</h3>
        <div className="perm" style={{ border: 0, padding: 0 }}>
          <select
            className="app-sel" value={entry.gated ? "gated" : "open"}
            onChange={(e) => patch({ gated: e.target.value === "gated" })}
          >
            <option value="open">Everyone who may sign in</option>
            <option value="gated">Only the groups below</option>
          </select>
        </div>
        {!entry.path && (
          <p className="note" style={{ marginTop: 10 }}>
            No page of its own, so nothing to route: the parts of the intranet that check this
            permission enforce it themselves. API checks apply immediately; anything the browser
            decides from a sign-in role applies at each person's next sign-in.
          </p>
        )}
        {entry.path && (
          <p className="note ok" style={{ marginTop: 10 }}>
            Takes effect at each person's next sign-in. No deploy needed. A path under{" "}
            <code>/apps/</code> is guarded by the rule its folder generates at deploy time; any
            other path needs this line in <code>staticwebapp.config.json</code> by hand:
            <br /><code style={{ display: "inline-block", marginTop: 6 }}>{routeRule}</code>
          </p>
        )}
      </div>

      <div className="field">
        <h3>Home page tile</h3>
        <label className="check">
          <input type="checkbox" checked={!!entry.showOnHome} onChange={(e) => patch({ showOnHome: e.target.checked })} />
          Show a tile on the home page (only to people who may open it)
        </label>
        {entry.showOnHome && (
          <div className="tile-fields">
            <p className="help">Description</p>
            <textarea className="wide" rows={3} value={entry.description || ""}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="One or two sentences: what it is for." />
            <p className="help">Link {entry.path ? "(leave empty to open the app's own page)" : "(required: this entry has no page)"}</p>
            <input className="wide" type="text" value={entry.url || ""}
              onChange={(e) => patch({ url: e.target.value.trim() })}
              placeholder={entry.path ? entry.path.replace(/\*$/, "") : "https://…"} />
            <div className="row">
              <label>Order <input type="text" inputMode="numeric" value={entry.order ?? ""} style={{ width: 70 }}
                onChange={(e) => patch({ order: e.target.value === "" ? "" : Number(e.target.value) || 0 })} /></label>
              <label>State <select value={entry.status || ""} onChange={(e) => patch({ status: e.target.value })}>
                <option value="">Live</option>
                <option value="planned">Coming soon (shown to everyone, not clickable)</option>
              </select></label>
            </div>
          </div>
        )}
      </div>

      <div className="field">
        <h3>Groups with access</h3>
        {!entry.gated && (
          <p className="note" style={{ margin: "0 0 10px" }}>
            This app is open to everyone who may sign in, so these grants do not decide who gets in.
            They still matter where the app asks for a grant itself, for example when only
            groups with write may edit.
          </p>
        )}
        {rows.length === 0 && <p className="note" style={{ margin: "0 0 10px" }}>No group grants this app yet.</p>}
        {rows.map((r) => (
          <div className="perm" key={r.group + ":" + r.index}>
            <span className="app-sel" style={{ fontWeight: 600 }}>{groups[r.group].label || r.group}</span>
            <select
              className="lvl-sel" value={r.perm.action || "read"}
              onChange={(e) => updatePerm(r.group, r.index, Object.assign({}, r.perm, { action: e.target.value }))}
            >
              {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              {!LEVELS.some((l) => l.id === r.perm.action) && r.perm.action && (
                <option value={r.perm.action}>{r.perm.action} (custom)</option>
              )}
            </select>
            {SCOPED_APPS.includes(app) && (
              <select
                className="unit-sel" value={(r.perm.scope || {}).unit || ""}
                onChange={(e) => {
                  const scope = Object.assign({}, r.perm.scope);
                  if (e.target.value) scope.unit = e.target.value; else delete scope.unit;
                  updatePerm(r.group, r.index, Object.assign({}, r.perm, {
                    scope: Object.keys(scope).length ? scope : undefined,
                  }));
                }}
              >
                <option value="">All units</option>
                {UNITS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            )}
            <span className="grow" />
            <button className="btn danger" onClick={() => removePerm(r.group, r.index)}>Remove</button>
          </div>
        ))}
        <AddPick options={ungranted} placeholder="Give another group access…" label="Grant read" onAdd={grant} />
      </div>

      <div className="footer-actions">
        <span className="spacer" />
        <button className="btn danger" onClick={removeApp}>Remove from registry</button>
      </div>
    </div>
  );
}


/* ---------- Users ---------- */
function UsersView({ store }) {
  const { groups, users } = store.data;
  const [q, setQ] = useState("");
  const emails = Object.keys(users).sort();
  const [sel, setSel] = useSelection(emails);
  const [open, setOpen] = useState(false);
  const pick = (id) => { setSel(id); setOpen(true); };

  const items = emails
    .filter((e) => !q || e.toLowerCase().includes(q.toLowerCase()))
    .map((e) => {
      const n = effectiveByApp(e, groups, users).length;
      return { id: e, name: e, meta: n ? n + (n === 1 ? " grant" : " grants") : "no grants" };
    });

  const addUser = async () => {
    const v = await askDialog({
      title: "Add a person",
      message: "Add someone by email to put them in groups. People can also get access automatically by email domain (see Groups).",
      fields: [{ name: "email", label: "Email address", placeholder: "name@company.com" }],
      validate: (x) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email.trim()) ? "" : "Enter an email address."),
      confirmLabel: "Add",
    });
    if (!v) return;
    const e = v.email.trim().toLowerCase();
    if (!users[e]) store.setUsers((u) => Object.assign({}, u, { [e]: [] }));
    pick(e);
  };

  return (
    <div className={"split" + (open ? " show-detail" : "")}>
      <Rail
        title="Users" help="One person at a time: which groups they're in, and what that adds up to per app."
        items={items} selected={sel} onSelect={pick} search={q} onSearch={setQ}
        action={<button className="btn primary" onClick={addUser}>New</button>}
      />
      <div className="detail">
        <BackToList label="All users" onClick={() => setOpen(false)} />
        {!sel ? <div className="empty">No named users. Access can still be granted by email domain — see Groups.</div>
              : <UserDetail key={sel} email={sel} store={store} onSelect={setSel} />}
      </div>
    </div>
  );
}

function UserDetail({ email, store, onSelect }) {
  const { apps, groups, users } = store.data;
  const explicit = users[email] || [];
  const auto = autoGroupsFor(email, groups);
  const granted = effectiveByApp(email, groups, users);
  const member = isMemberIn(apps, groups, users, email);

  /* Group permissions are only half the story: apps that are open to everyone are openable by
     everyone, so leaving them out made this list read as "these are the only apps you can use".
     Merge them in — an open app the person also holds a permission for keeps its level. */
  const open = openAppIds(apps);
  const byApp = {};
  granted.forEach((e) => { byApp[e.app] = Object.assign({}, e, { openToAll: open.indexOf(e.app) !== -1 }); });
  open.forEach((id) => {
    if (!byApp[id]) byApp[id] = { app: id, best: null, grants: [], openToAll: true };
  });
  const effective = Object.values(byApp).sort((a, b) =>
    appLabelIn(apps, a.app).localeCompare(appLabelIn(apps, b.app)));

  const addable = groupNames(groups)
    .filter((n) => explicit.indexOf(n) === -1)
    .map((n) => ({ id: n, label: groups[n].label || n }));

  const removeUser = async () => {
    if (!(await confirmDialog("Remove person", `Remove ${email}? Any access from their email domain stays in effect.`, "Remove"))) return;
    store.setUsers((u) => { const c = Object.assign({}, u); delete c[email]; return c; });
    onSelect(null);
  };

  return (
    <div className="detail-inner">
      <div className="detail-head"><h2>{email}</h2></div>
      <p className="detail-sub">
        {effective.length
          ? "Below: everything this person can open — what their groups grant, plus every app open to everyone."
          : "This person has no app access yet."}
      </p>
      <p className={member ? "note ok" : "note"} style={{ marginBottom: 20 }}>
        {member
          ? "Member of the intranet: the home page with all their apps, and the Langdock connection."
          : "App-only guest: no home page and no Langdock connection — only the apps listed below, and user apps shared with them by link."}
      </p>

      <div className="field">
        <h3>Groups</h3>
        <div className="chips">
          {explicit.length === 0 && auto.length === 0 && <span className="note">In no groups.</span>}
          {explicit.map((n) => (
            <Chip key={n} label={groups[n] ? (groups[n].label || n) : n + " (missing)"}
              onRemove={() => store.setMembership(email, n, false)} />
          ))}
          {auto.map((n) => (
            <Chip key={n} auto title={"Automatic — " + domainOf(email) + " is a domain on this group"}
              label={(groups[n].label || n) + " · automatic"} />
          ))}
        </div>
        <AddPick options={addable} placeholder="Add to a group…" label="Add"
          onAdd={(n) => store.setMembership(email, n, true)} />
        {auto.length > 0 && (
          <p className="note" style={{ marginTop: 10 }}>
            Greyed-out groups come from the email domain <strong>{domainOf(email)}</strong> and can't be removed here —
            change the group's domain list instead.
          </p>
        )}
      </div>

      <div className="field">
        <h3>Effective access</h3>
        <p className="help">Every app this person can open, and at what level.</p>
        {effective.length === 0 ? <p className="note">No access to any app.</p> : (
          <div className="eff">
            {effective.map((e) => (
              <div className="eff-row" key={e.app}>
                <span className="app">{appLabelIn(apps, e.app)}</span>
                {e.best !== null ? <Badge tier={e.best} /> : <span className="badge open">Open</span>}
                <span className="via">
                  {e.grants.length === 0
                    ? "open to everyone"
                    : e.grants.map((g, i) => (
                        <span key={i}>
                          {i > 0 ? " · " : ""}
                          {g.scope ? scopeText(g.scope) + " " : ""}via {groups[g.via] ? (groups[g.via].label || g.via) : g.via}
                        </span>
                      ))}
                  {e.grants.length > 0 && e.openToAll ? " · open to everyone" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="footer-actions">
        <span className="spacer" />
        <button className="btn danger" onClick={removeUser}>Remove user</button>
      </div>
    </div>
  );
}

Object.assign(window, { GroupsView, AppsView, UsersView, DialogHost });
