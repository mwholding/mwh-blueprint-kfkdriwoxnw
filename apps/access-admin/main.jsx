/* main.jsx — shell: header with save state, the three tabs, and the active view. */

const TABS = [
  { id: "groups", label: "Groups", Comp: () => GroupsView },
  { id: "apps", label: "Apps", Comp: () => AppsView },
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
  const [tab, setTab] = useState("groups");
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
          store.saveState !== "idle" && <span className="save">{SAVE_TEXT[store.saveState]}</span>
        )}
      </header>

      {store.data && (
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      )}

      {!store.loaded && <div className="empty">Loading…</div>}
      {store.loaded && !store.data && <div className="empty">{store.error || "Could not load access data."}</div>}
      {store.data && <View store={store} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
