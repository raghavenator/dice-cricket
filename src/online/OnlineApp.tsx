export function OnlineApp() {
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand on-link" href="./index.html">
          <span aria-hidden>🎲</span> Dice Cricket
        </a>
      </header>
      <main>
        <div className="screen">
          <h2>Online 1v1</h2>
          <p className="muted">Play a friend on another computer. This mode is still being built.</p>
          <div className="nav-row">
            <a className="btn btn-ghost on-link" href="./index.html">← Back to Dice Cricket</a>
          </div>
        </div>
      </main>
    </div>
  );
}
