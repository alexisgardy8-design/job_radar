"use client";
/** Composants d'interface partagés. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { logout } from "./actions.ts";

/* ---------------- Navigation ---------------- */

export function Nav({ active, email }: { active: "offres" | "reglages"; email: string }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-dot" />Job Radar</Link>
      <nav className="tabs">
        <Link href="/" className={active === "offres" ? "active" : ""}>🎯 Mes matchs</Link>
        <Link href="/settings" className={active === "reglages" ? "active" : ""}>⚙️ Profil & réglages</Link>
      </nav>
      <div className="me">
        <span className="avatar" title={email}>{email.slice(0, 1).toUpperCase()}</span>
        <form action={logout}><button className="btn ghost small" type="submit">Déconnexion</button></form>
      </div>
    </header>
  );
}

/* ---------------- Messages (toast) ---------------- */

export function Flash({ flash }: { flash: { kind: "ok" | "err"; msg: string } | null }) {
  const [open, setOpen] = useState(true);
  const long = (flash?.msg.length ?? 0) > 140; // codes de secours, jeton : on laisse affiché
  useEffect(() => {
    if (!flash || long) return;
    const t = setTimeout(() => setOpen(false), 7000);
    return () => clearTimeout(t);
  }, [flash, long]);
  if (!flash || !open) return null;
  return (
    <div className={`toast ${flash.kind}`} role="status">
      <span className="toast-icon">{flash.kind === "ok" ? "✅" : "⚠️"}</span>
      <span className="toast-msg">{flash.msg}</span>
      <button className="toast-close" onClick={() => setOpen(false)} aria-label="Fermer">×</button>
    </div>
  );
}

/* ---------------- Boutons et attente ---------------- */

export function SubmitButton({ children, pendingText, className = "btn primary" }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending && <span className="spinner" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** Étapes estimées affichées pendant une action longue (ex. lecture du CV). À placer dans le <form>. */
export function PendingSteps({ steps, everyMs = 4000 }: { steps: string[]; everyMs?: number }) {
  const { pending } = useFormStatus();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!pending) { setI(0); return; }
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), everyMs);
    return () => clearInterval(t);
  }, [pending, steps.length, everyMs]);
  if (!pending) return null;
  return (
    <div className="pending">
      <div className="bar"><div className="bar-fill indeterminate" /></div>
      <ol className="steps">
        {steps.map((s, k) => (
          <li key={s} className={k < i ? "done" : k === i ? "now" : ""}>{k < i ? "✓" : k === i ? <span className="spinner" /> : "•"} {s}</li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------- Anneau de score / progression ---------------- */

export function Ring({ value, size = 56, stroke = 6, label, tone }: { value: number; size?: number; stroke?: number; label?: React.ReactNode; tone?: "good" | "mid" | "low" | "brand" }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`ring ${tone ?? ""}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="ring-value"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-label">{label ?? v}</span>
    </div>
  );
}

/* ---------------- Scan avec progression en direct ---------------- */

type ScanEvent =
  | { type: "collect"; sources: string[] }
  | { type: "source"; name: string; count: number; error?: string; done: number; total: number }
  | { type: "filter"; fetched: number; fresh: number; toScore: number }
  | { type: "scoring"; done: number; total: number; best: number | null }
  | { type: "email"; sent: number }
  | { type: "done"; report: { fetched: number; fresh: number; scored: number; matched: number; sent: number; best: number | null; errors: string[] }; top: { title: string; company: string | null; score: number }[] }
  | { type: "error"; message: string };

const TIPS = [
  "On parcourt LinkedIn, Indeed, HelloWork et les sites carrière…",
  "L'IA compare chaque offre à ton CV, ligne par ligne…",
  "Astuce : des mots-clés précis donnent des matchs plus pertinents.",
  "Les offres déjà vues ne sont jamais renotées : chaque scan ne traite que du neuf.",
  "Astuce : active la 2FA dans ton profil pour protéger ton compte.",
];

interface ScanState {
  phase: "idle" | "running" | "done" | "error";
  sources: { name: string; count: number | null; error?: string }[];
  filter?: { fetched: number; fresh: number; toScore: number };
  scoring?: { done: number; total: number; best: number | null };
  email?: number;
  result?: Extract<ScanEvent, { type: "done" }>;
  error?: string;
}

function progressOf(s: ScanState): number {
  if (s.phase === "done") return 100;
  if (s.scoring && s.scoring.total) return 40 + Math.round((s.scoring.done / s.scoring.total) * 50);
  if (s.filter) return 40;
  const n = s.sources.length;
  return n ? 5 + Math.round((s.sources.filter((x) => x.count !== null).length / n) * 30) : 5;
}

export function ScanPanel({ hasCv, threshold }: { hasCv: boolean; threshold: number }) {
  const router = useRouter();
  const [s, setS] = useState<ScanState>({ phase: "idle", sources: [] });
  const [tip, setTip] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);

  useEffect(() => {
    if (s.phase !== "running") return;
    const t = setInterval(() => { setElapsed(Math.round((Date.now() - started.current) / 1000)); setTip((x) => (x + 1) % TIPS.length); }, 4000);
    const e = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000);
    return () => { clearInterval(t); clearInterval(e); };
  }, [s.phase]);

  function apply(e: ScanEvent) {
    setS((prev) => {
      switch (e.type) {
        case "collect": return { ...prev, sources: e.sources.map((name) => ({ name, count: null })) };
        case "source": return { ...prev, sources: prev.sources.map((x) => (x.name === e.name ? { ...x, count: e.count, error: e.error } : x)) };
        case "filter": return { ...prev, filter: e };
        case "scoring": return { ...prev, scoring: e };
        case "email": return { ...prev, email: e.sent };
        case "done": return { ...prev, phase: "done", result: e };
        case "error": return { ...prev, phase: "error", error: e.message };
      }
    });
  }

  async function start() {
    started.current = Date.now();
    setElapsed(0);
    setS({ phase: "running", sources: [] });
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return apply({ type: "error", message: body.error ?? `Erreur ${res.status}` });
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) apply(JSON.parse(line) as ScanEvent);
      }
      setS((prev) => (prev.phase === "running" ? { ...prev, phase: "error", error: "Le scan s'est interrompu. Réessaie dans quelques minutes." } : prev));
    } catch {
      apply({ type: "error", message: "Connexion perdue pendant le scan." });
    }
  }

  if (!hasCv) {
    return (
      <div className="scan-panel">
        <p className="muted">Importe ton CV pour débloquer le scan.</p>
        <Link className="btn primary big" href="/settings#cv">📄 Importer mon CV</Link>
      </div>
    );
  }

  if (s.phase === "idle") {
    return (
      <div className="scan-panel">
        <button className="btn primary big glow" onClick={start}>🚀 Lancer un scan</button>
        <p className="muted small">1 à 4 minutes · tu peux rester sur la page</p>
      </div>
    );
  }

  const pct = progressOf(s);
  const step = (on: boolean, done: boolean) => (done ? "done" : on ? "now" : "");
  const collecting = !s.filter;
  const scoring = !!s.filter && s.phase === "running";

  return (
    <div className="scan-panel live">
      {s.phase === "running" && (
        <>
          <div className="live-head"><b>Scan en cours</b><span className="muted">{elapsed}s</span></div>
          <div className="bar"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
          <ol className="steps">
            <li className={step(collecting, !collecting)}>
              {collecting ? <span className="spinner" /> : "✓"} Recherche des offres
              <div className="substeps">
                {s.sources.map((x) => (
                  <span key={x.name} className={`chip ${x.error ? "bad" : x.count !== null ? "ok" : ""}`}>
                    {x.count === null ? "…" : x.error ? "✗" : x.count} · {x.name}
                  </span>
                ))}
              </div>
            </li>
            <li className={step(!!s.filter && !s.scoring, !!s.scoring)}>
              {s.scoring ? "✓" : s.filter ? <span className="spinner" /> : "•"} Tri selon tes filtres
              {s.filter && <span className="muted"> · {s.filter.fresh} nouvelles, {s.filter.toScore} à analyser</span>}
            </li>
            <li className={step(scoring, false)}>
              {scoring ? <span className="spinner" /> : "•"} Analyse IA face à ton CV
              {s.scoring && s.scoring.total > 0 && (
                <span className="muted"> · {s.scoring.done}/{s.scoring.total}{s.scoring.best !== null ? ` · meilleur score ${s.scoring.best}` : ""}</span>
              )}
            </li>
          </ol>
          <p className="tip">💡 {TIPS[tip]}</p>
        </>
      )}

      {s.phase === "done" && s.result && (
        <div className={`result ${s.result.report.matched ? "win" : ""}`}>
          {s.result.report.matched > 0 && <div className="confetti" aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} />)}</div>}
          <div className="result-head">
            <Ring value={s.result.report.best ?? 0} size={72} stroke={7} tone={(s.result.report.best ?? 0) >= threshold ? "good" : "mid"} label={s.result.report.best ?? "–"} />
            <div>
              <h3>{s.result.report.matched ? `🎉 ${s.result.report.matched} nouveau${s.result.report.matched > 1 ? "x" : ""} match${s.result.report.matched > 1 ? "s" : ""} !` : "Scan terminé"}</h3>
              <p className="muted">
                {s.result.report.fetched} offres trouvées · {s.result.report.fresh} nouvelles · {s.result.report.scored} analysées
                {s.result.report.sent ? ` · ${s.result.report.sent} envoyées par e-mail` : ""}
              </p>
            </div>
          </div>
          {s.result.top.length > 0 && (
            <ul className="top-list">{s.result.top.map((t) => <li key={t.title + t.score}><b>{t.score}</b> {t.title}{t.company ? ` · ${t.company}` : ""}</li>)}</ul>
          )}
          {!s.result.report.matched && <p className="muted">Rien au-dessus de {threshold} cette fois. Élargis tes mots-clés ou baisse ton score minimum.</p>}
          {s.result.report.errors.length > 0 && <details className="muted small"><summary>{s.result.report.errors.length} remarque(s)</summary><ul>{s.result.report.errors.map((e) => <li key={e}>{e}</li>)}</ul></details>}
          <button className="btn primary" onClick={() => { setS({ phase: "idle", sources: [] }); router.refresh(); }}>Voir mes matchs</button>
        </div>
      )}

      {s.phase === "error" && (
        <div className="result">
          <h3>⚠️ {s.error}</h3>
          <button className="btn" onClick={() => setS({ phase: "idle", sources: [] })}>OK</button>
        </div>
      )}
    </div>
  );
}
