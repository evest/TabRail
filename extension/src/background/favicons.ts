import type { FaviconLookup } from './snapshot';

/** Fetches a favicon as a data URL. In the extension: the _favicon endpoint. */
export type FaviconFetcher = (pageUrl: string) => Promise<string | null>;

const MAX_ENTRIES = 500;
const RETRY_MS = 60_000;

/**
 * Per-host favicon cache (in memory only; it is cheap to rebuild after a SW restart).
 * Chrome's _favicon endpoint returns a generic globe for unknown pages. We never cache
 * that as the host's icon, and retry later because the page may simply not have loaded yet.
 */
export class FaviconCache implements FaviconLookup {
  private readonly data = new Map<string, string>();
  private readonly missingUntil = new Map<string, number>();
  private readonly inflight = new Set<string>();
  private defaultIcon: string | null | undefined;

  constructor(
    private readonly fetcher: FaviconFetcher,
    private readonly now: () => number = Date.now,
  ) {}

  keyFor(url: string): string | undefined {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : undefined;
    } catch {
      return undefined;
    }
  }

  get(key: string): string | undefined {
    return this.data.get(key);
  }

  /**
   * Resolve the icon for a page. Resolves true if the cache gained an entry.
   * `force` skips the retry cooldown (use when Chrome just reported a new favIconUrl).
   */
  async ensure(pageUrl: string, force = false): Promise<boolean> {
    const key = this.keyFor(pageUrl);
    if (!key || this.data.has(key) || this.inflight.has(key)) return false;
    if (!force && (this.missingUntil.get(key) ?? 0) > this.now()) return false;
    this.inflight.add(key);
    try {
      if (this.defaultIcon === undefined) {
        this.defaultIcon = await this.fetcher('https://tabrail.invalid/').catch(() => null);
      }
      const icon = await this.fetcher(pageUrl).catch(() => null);
      if (!icon || icon === this.defaultIcon) {
        this.missingUntil.set(key, this.now() + RETRY_MS);
        return false;
      }
      this.missingUntil.delete(key);
      this.data.set(key, icon);
      if (this.data.size > MAX_ENTRIES) this.data.delete(this.data.keys().next().value!);
      return true;
    } finally {
      this.inflight.delete(key);
    }
  }
}

/** Verified in the Step 0 spike: a service worker can fetch its own _favicon endpoint (Chrome 157). */
export function extensionFaviconFetcher(extensionFaviconBase: string): FaviconFetcher {
  return async (pageUrl) => {
    const u = new URL(extensionFaviconBase);
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', '16');
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return null;
    // The endpoint returns an empty Content-Type; it serves PNG.
    return `data:image/png;base64,${toBase64(bytes)}`;
  };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
