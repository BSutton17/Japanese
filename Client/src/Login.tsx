import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback(response: { credential: string }): void }): void;
      renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";

let googleScript: Promise<void> | undefined;

function loadGoogleScript(): Promise<void> {
  googleScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleScript = undefined;
      script.remove();
      reject(new Error("Google sign-in failed to load. Check your connection and reload."));
    };
    document.head.append(script);
  });
  return googleScript;
}

export function Login({ onSignedIn }: { onSignedIn(email: string): void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const clientId = import.meta.env.GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId) {
      setError("GOOGLE_CLIENT_ID isn't set. Add it to .env.local and restart.");
      return;
    }

    let active = true;
    loadGoogleScript()
      .then(() => {
        if (!active || !buttonRef.current) return;
        window.google!.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            setError(undefined);
            api
              .signIn(credential)
              .then(({ email }) => onSignedIn(email))
              .catch((signInError: unknown) => {
                setError(signInError instanceof ApiError ? signInError.message : "Sign-in failed. Try again.");
              });
          },
        });
        window.google!.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "signin_with",
        });
      })
      .catch((loadError: Error) => active && setError(loadError.message));
    return () => {
      active = false;
    };
  }, [onSignedIn]);

  return (
    <main className="center login">
      <p className="login-mark" aria-hidden="true">日本語</p>
      <h1>Japanese Tutor</h1>
      <div ref={buttonRef} className="google-button" />
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
