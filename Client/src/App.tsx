import { useEffect, useState } from "react";
import { ApiError, api } from "./api";
import { KanaTab } from "./kana/KanaTab";
import { Login } from "./Login";

type AuthState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; email: string }
  | { kind: "error"; message: string };

const TABS = ["Talk", "Vocab", "Kana", "Progress"];
const ACTIVE_TAB = "Kana";

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    api
      .me()
      .then(({ email }) => active && setAuth({ kind: "signed-in", email }))
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) setAuth({ kind: "signed-out" });
        else setAuth({ kind: "error", message: "Couldn't reach the server. Check your connection and reload." });
      });
    return () => {
      active = false;
    };
  }, []);

  if (auth.kind === "loading") return <main className="center muted">Loading…</main>;
  if (auth.kind === "error") return <main className="center" role="alert">{auth.message}</main>;
  if (auth.kind === "signed-out") {
    return <Login onSignedIn={(email) => setAuth({ kind: "signed-in", email })} />;
  }

  const signOut = () => {
    void api.signOut().finally(() => setAuth({ kind: "signed-out" }));
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">日本語 Tutor</span>
        <button className="link" onClick={signOut}>Sign out</button>
      </header>
      <main className="content">
        <KanaTab />
      </main>
      <nav className="tabs" aria-label="Sections">
        {TABS.map((tab) =>
          tab === ACTIVE_TAB ? (
            <span key={tab} className="tab tab-active" aria-current="page">{tab}</span>
          ) : (
            <span key={tab} className="tab tab-soon" aria-disabled="true">{tab}<small>Soon</small></span>
          ),
        )}
      </nav>
    </div>
  );
}
