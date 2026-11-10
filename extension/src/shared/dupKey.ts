/**
 * Identity for duplicate-tab detection, shared by the service worker and the UI: the URL without
 * its #fragment. Blank and new-tab pages never count as duplicates (having several open is normal).
 */
export function dupKey(url: string): string | null {
  const u = url.split('#')[0]!;
  if (
    !u ||
    /^(about:blank|about:newtab|chrome:\/\/newtab|chrome:\/\/new-tab-page|edge:\/\/newtab)/.test(u)
  )
    return null;
  return u;
}
