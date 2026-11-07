"use client";
/** Composants d'interface partagés. */

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { logout } from "./actions.ts";

export function Nav({ active, email }: { active: "offres" | "reglages"; email: string }) {
  return (
    <header className="top">
      <div>
        <h1>Job Radar</h1>
        <div className="muted">{email}</div>
      </div>
      <nav>
        <Link href="/" className={active === "offres" ? "active" : ""}>Offres</Link>
        <Link href="/settings" className={active === "reglages" ? "active" : ""}>Réglages et sécurité</Link>
        <form action={logout}><button className="btn" type="submit">Déconnexion</button></form>
      </nav>
    </header>
  );
}

export function Flash({ flash }: { flash: { kind: "ok" | "err"; msg: string } | null }) {
  return flash ? <div className={`flash${flash.kind === "err" ? " err" : ""}`} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{flash.msg}</div> : null;
}

export function SubmitButton({ children, pendingText, className = "btn primary" }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
