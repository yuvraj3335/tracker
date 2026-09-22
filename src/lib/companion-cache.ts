/**
 * The tracker snapshot, kept warm.
 *
 * Reading the tracker means three Notion queries, and Notion is not fast.
 * Doing that before every single message put the whole round trip in front of
 * the reply — so the companion sat silent for seconds while it re-read
 * numbers that had not changed since the last thing you said. That is most of
 * what "it is laggy" actually was; the voice was being blamed for a database.
 *
 * So: cache it, serve it stale while refreshing behind the answer, and never
 * let a slow read hold up a conversation. The numbers being a minute old is
 * not a correctness problem — the companion is asked "how am I doing", not
 * asked to settle an audit — and a companion that answers late is a worse
 * failure than one quoting a count from forty seconds ago.
 */

/** Fresh enough to use without thinking about it. */
export const FRESH_MS = 60_000;

/** Old, but far better than nothing while a new one is fetched. */
export const STALE_MS = 10 * 60_000;

/**
 * The longest a conversation will ever wait on Notion.
 *
 * Only reachable with a cold cache. Past this the companion answers without
 * the tracker rather than leaving someone talking to silence — it can say
 * plenty about being tired and hungry without knowing a streak, and the read
 * carries on in the background so the next message has it.
 */
export const PATIENCE_MS = 1_200;

type Entry = { snapshot: string | null; at: number; inflight?: Promise<string | null> };

const cache = new Map<string, Entry>();

export const age = (entry: Entry, now: number) => now - entry.at;
export const isFresh = (entry: Entry, now: number) => age(entry, now) < FRESH_MS;
export const isUsable = (entry: Entry, now: number) => age(entry, now) < STALE_MS;

/** Testing seam. Module state outlives a single test otherwise. */
export function clearSnapshots() {
  cache.clear();
}

/**
 * Resolves, or gives up waiting — whichever happens first.
 *
 * The work is never cancelled, only stopped being waited on, so a slow read
 * still lands in the cache and still makes the next message quick.
 */
export function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * The snapshot for a tenant, as quickly as it can be had.
 *
 * Fresh, it returns immediately. Stale, it returns immediately and refreshes
 * behind the reply. Missing, it waits — but only briefly.
 */
export async function snapshotFor(
  key: string,
  load: () => Promise<string | null>,
  now = Date.now(),
): Promise<string | null> {
  const entry = cache.get(key);

  if (entry && isFresh(entry, now)) return entry.snapshot;

  // One clock, passed in. Stamping entries from `Date.now()` while judging
  // their age against the caller's `now` means the two never agree, and an
  // injected clock can then never expire anything — which is exactly the sort
  // of thing that looks fine until the cache quietly stops refreshing.
  const refresh = () => {
    const existing = cache.get(key);
    // One read at a time per tenant. Without this, a burst of messages on a
    // cold cache would each start their own, which is the opposite of the
    // point.
    if (existing?.inflight) return existing.inflight;

    const inflight = load()
      .then((snapshot) => {
        cache.set(key, { snapshot, at: now });
        return snapshot;
      })
      .catch(() => {
        // Keep whatever was there. A failed refresh should not throw away a
        // usable answer.
        const kept = cache.get(key);
        if (kept) cache.set(key, { snapshot: kept.snapshot, at: kept.at });
        return kept?.snapshot ?? null;
      });

    cache.set(key, { snapshot: existing?.snapshot ?? null, at: existing?.at ?? 0, inflight });
    return inflight;
  };

  if (entry && isUsable(entry, now)) {
    // Stale but serviceable: answer now, correct the record afterwards.
    void refresh();
    return entry.snapshot;
  }

  return within(refresh(), PATIENCE_MS);
}
