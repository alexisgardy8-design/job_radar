"use client";

import { useFormStatus } from "react-dom";

export function ScanButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn small primary" type="submit" disabled={pending} style={{ marginTop: 6 }}>
      {pending ? "Scan en cours (1 à 4 min)…" : "Scanner maintenant"}
    </button>
  );
}
