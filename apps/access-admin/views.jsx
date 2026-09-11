/* views.jsx — three ways into the same data:
   Groups (a group's members + what it grants), Apps (who can get into one app),
   Users (one person's groups + what that adds up to). */

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

function Rail({ title, help, items, selected, onSelect, search, onSearch, action }) {
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
        {items.length === 0 && <div className="empty" style={{ padding: "20px 16px", fontSize: 13 }}>Nothing here yet.</div>}
        {items.map((it) => (
          <button
            key={it.id}
            className={"rail-item" + (it.id === selected ? " active" : "")}
            onClick={() => onSelect(it.id)}
          >
            <span className="n">{it.name}</span>
            <span className="m">{it.meta}</span>
          </button>
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
  const brand = scope.brand || "";
  // Scopes other than brand aren't editable here — shown so they can't be silently lost.
  const otherScope = Object.keys(scope).filter((k) => k !== "brand");

  const setBrand = (val) => {
    const next = Object.assign({}, scope);
    if (val) next.brand = val; else delete next.brand;
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
        <select className="brand-sel" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All units</option>
          {BRANDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
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

  const addGroup = () => {
    const raw = prompt("Name for the new group:");
    if (!raw) return;
    const key = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!key) return;
    if (groups[key]) { alert("A group with that key already exists."); return; }
    store.setGroups((g) => Object.assign({}, g, { [key]: { label: raw.trim(), domains: [], permissions: [] } }));
    setSel(key);
  };

  return (
    <div className="split">
      <Rail
        title="Groups" help="A group bundles app permissions. People join by name, or automatically by email domain."
        items={items} selected={sel} onSelect={setSel} search={q} onSearch={setQ}
        action={<button className="btn primary" onClick={addGroup}>New</button>}
      />
      <div className="detail">
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

  const renameKey = () => {
    const next = prompt("Internal key for this group (no spaces):", name);
    if (!next || next === name) return;
    const key = next.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (groups[key]) { alert("A group with that key already exists."); return; }
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

  const remove = () => {
    if (!confirm(`Delete the group "${group.label || name}"? Everyone in it loses what it granted.`)) return;
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
  // No registered path means no page — it is a permission other code checks (an MCP-only
  // capability, say), so "open to all staff" would be nonsense for it.
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
      if (isPageless(a)) {
        meta = c ? "permission only · " + c + (c === 1 ? " group" : " groups") : "permission only";
      } else if (!entry) {
        // A permission points at an id nothing registers, so the role it grants opens nothing.
        meta = "not registered";
      } else if (!entry.gated) {
        meta = "open to all staff";
      } else {
        meta = c ? c + (c === 1 ? " group" : " groups") : "restricted, nobody yet";
      }
      return { id: a, name: labelFor(a), meta };
    });

  const addApp = () => {
    const name = prompt("Name of the app or page (e.g. Board Reports):");
    if (!name) return;
    const id = slugify(name);
    if (!id) return;
    if (apps[id]) { alert('"' + id + '" already exists.'); return; }
    const path = normalisePath(prompt("Path to protect (e.g. /apps/board-reports/):", "/apps/" + id + "/") || "");
    store.setApps((a) => Object.assign({}, a, {
      [id]: { label: name.trim(), path, gated: true },
    }));
    setSel(id);
  };

  return (
    <div className="split">
      <Rail
        title="Apps" help="Everything that can be gated, and who gets in. Add a new app with a name and a path."
        items={items} selected={sel} onSelect={setSel} search={q} onSearch={setQ}
        action={<button className="btn primary" onClick={addApp}>New</button>}
      />
      <div className="detail">
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
    [app]: { label: app, path: "/apps/" + app + "/*", gated: true },
  }));

  const removeApp = () => {
    if (rows.length && !confirm(`${rows.length} group permission(s) still point at "${app}". Remove the app anyway? The permissions stay and will show as "not registered".`)) return;
    else if (!rows.length && !confirm(`Remove "${entry.label || app}" from the registry?`)) return;
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
              <strong>The whole intranet is restricted.</strong> Only members of the groups below can
              use it at all — every page and every API. Anyone else gets the sign-in-again page even
              with a valid company address.
            </>
          ) : (
            <>
              This is the front door, not one app: <strong>open</strong> means any allowed email domain
              is enough. Restrict it to require group membership instead — useful when a tenant holds
              far more people than should have access.
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
            <option value="open">Any signed-in staff member</option>
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
        <h3>Groups with access</h3>
        {!entry.gated && (
          <p className="note" style={{ margin: "0 0 10px" }}>
            This app is open to every signed-in staff member, so these grants only matter for
            read/write levels inside the app — not for getting in.
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
                className="brand-sel" value={(r.perm.scope || {}).brand || ""}
                onChange={(e) => {
                  const scope = Object.assign({}, r.perm.scope);
                  if (e.target.value) scope.brand = e.target.value; else delete scope.brand;
                  updatePerm(r.group, r.index, Object.assign({}, r.perm, {
                    scope: Object.keys(scope).length ? scope : undefined,
                  }));
                }}
              >
                <option value="">All units</option>
                {BRANDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
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

  const items = emails
    .filter((e) => !q || e.toLowerCase().includes(q.toLowerCase()))
    .map((e) => {
      const n = effectiveByApp(e, groups, users).length;
      return { id: e, name: e, meta: n ? n + (n === 1 ? " grant" : " grants") : "no grants" };
    });

  const addUser = () => {
    const raw = prompt("Email address:");
    if (!raw) return;
    const e = raw.trim().toLowerCase();
    if (!e) return;
    if (!users[e]) store.setUsers((u) => Object.assign({}, u, { [e]: [] }));
    setSel(e);
  };

  return (
    <div className="split">
      <Rail
        title="Users" help="One person at a time: which groups they're in, and what that adds up to per app."
        items={items} selected={sel} onSelect={setSel} search={q} onSearch={setQ}
        action={<button className="btn primary" onClick={addUser}>New</button>}
      />
      <div className="detail">
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

  /* Group permissions are only half the story: apps that are open to all staff are openable by
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

  const removeUser = () => {
    if (!confirm(`Remove ${email}? Any access from their email domain stays in effect.`)) return;
    store.setUsers((u) => { const c = Object.assign({}, u); delete c[email]; return c; });
    onSelect(null);
  };

  return (
    <div className="detail-inner">
      <div className="detail-head"><h2>{email}</h2></div>
      <p className="detail-sub">
        {effective.length
          ? "Below: everything this person can open — what their groups grant, plus every app open to all staff."
          : "This person has no app access yet."}
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
                    ? "open to all staff"
                    : e.grants.map((g, i) => (
                        <span key={i}>
                          {i > 0 ? " · " : ""}
                          {g.scope ? scopeText(g.scope) + " " : ""}via {groups[g.via] ? (groups[g.via].label || g.via) : g.via}
                        </span>
                      ))}
                  {e.grants.length > 0 && e.openToAll ? " · open to all staff" : ""}
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

Object.assign(window, { GroupsView, AppsView, UsersView });
