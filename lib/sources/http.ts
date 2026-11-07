const UA = "JobRadar/1.0 (personal job alert)";

export async function getJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", "User-Agent": UA, ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} sur ${new URL(url).host} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Exécute des tâches avec une concurrence limitée. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
