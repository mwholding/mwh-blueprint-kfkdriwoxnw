/* main.jsx — shell: header with save state, the three tabs, the active view, and the dialogs.
   The tab lives in the URL hash (#apps, #groups, #users) so a reload or a link keeps it. */

const TABS = [
  { id: "apps", label: "Apps", Comp: () => AppsView },
  { id: "groups", label: "Groups", Comp: () => GroupsView },
  { id: "users", label: "Users", Comp: () => UsersView },
];

const SAVE_TEXT = {
  pending: "Unsaved changes…",
  saving: "Saving…",
  saved: "All changes saved",
  error: "Not saved",
};

function App() {
  const store = useAccessStore();
  const fromHash = () => (TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : "apps");
  const [tab, setTabState] = useState(fromHash);
  useEffect(() => {
    const onHash = () => setTabState(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const setTab = (id) => { location.hash = id; setTabState(id); };
  const View = TABS.find((t) => t.id === tab).Comp();

  return (
    <div className="shell">
      <header className="topbar">
        <a className="back" href="/">
          <img src="/assets/logo.svg" alt="" />
          <span>&larr; Back to intranet</span>
        </a>
        <span className="title">Access Management</span>
        <span className="spacer" />
        {store.error ? (
          <span className="save err">{store.error}</span>
        ) : (
          store.saveState !== "idle" && <span className="save" role="status">{SAVE_TEXT[store.saveState]}</span>
        )}
      </header>

      {store.data && (
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      )}

      {!store.loaded && <div className="empty">Loading access data…</div>}
      {store.loaded && !store.data && (
        <div className="empty">
          <p><strong>{store.error || "Could not load access data."}</strong></p>
          <p>Check who you are signed in as at <a href="/.auth/me">/.auth/me</a>, or try again.</p>
          <button className="btn" onClick={() => location.reload()}>Try again</button>
        </div>
      )}
      {store.data && <View store={store} />}
      <DialogHost />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
