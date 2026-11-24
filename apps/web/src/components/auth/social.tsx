"use client";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { bff } from "@/lib/auth/client";

declare global {
  interface Window {
    google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } };
    AppleID?: { auth: { init: (o: object) => void; signIn: () => Promise<{ authorization: { id_token: string }; user?: { name?: { firstName?: string; lastName?: string } } }> } };
  }
}

const GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const APPLE = process.env.NEXT_PUBLIC_APPLE_SERVICE_ID;

/**
 * Google (Identity Services) and Apple (Sign in with Apple JS) return an ID token in the browser; the BFF
 * exchanges it with the backend, which verifies it against the provider's JWKS. Buttons render only when configured.
 */
export function SocialSignIn({ country, onResult, onError }: { country: string; onResult: (status: string) => void; onError: (code: string) => void }) {
  const googleEl = useRef<HTMLDivElement>(null);
  const [googleReady, setGoogleReady] = useState(false);

  const exchange = useCallback(async (provider: string, token: string, extra: Record<string, string> = {}) => {
    const r = await bff(`oauth/${provider}`, { token, country, ...extra });
    if (r.ok) onResult(r.data.status); else onError(r.problem.code);
  }, [country, onResult, onError]);

  useEffect(() => {
    if (!googleReady || !GOOGLE || !googleEl.current || !window.google) return;
    window.google.accounts.id.initialize({ client_id: GOOGLE, callback: (r: { credential: string }) => exchange("google", r.credential), ux_mode: "popup" });
    window.google.accounts.id.renderButton(googleEl.current, { theme: "outline", size: "large", width: 320, text: "continue_with", shape: "pill" });
  }, [googleReady, exchange]);

  const apple = async () => {
    if (!window.AppleID || !APPLE) return;
    window.AppleID.auth.init({ clientId: APPLE, scope: "name email", redirectURI: window.location.origin, usePopup: true });
    try {
      const r = await window.AppleID.auth.signIn();
      const n = r.user?.name;
      await exchange("apple", r.authorization.id_token, n ? { fullName: [n.firstName, n.lastName].filter(Boolean).join(" ") } : {});
    } catch { /* user closed the popup */ }
  };

  if (!GOOGLE && !APPLE) return null;
  return (
    <div className="flex flex-col items-center gap-3">
      {GOOGLE ? <><Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setGoogleReady(true)} /><div ref={googleEl} /></> : null}
      {APPLE ? (
        <>
          <Script src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js" strategy="afterInteractive" />
          <button type="button" onClick={apple} className="h-10 w-80 rounded-full bg-black text-sm font-semibold text-white">Continue with Apple</button>
        </>
      ) : null}
    </div>
  );
}
