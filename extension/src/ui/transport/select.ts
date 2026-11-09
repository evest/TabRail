import type { Transport } from './types';
import { WebViewTransport, getWebViewBridge } from './webview';
import { RuntimePortTransport } from './runtimePort';

/** WebView2 host -> native bridge; extension page -> runtime port; plain browser tab -> mock. */
export async function selectTransport(): Promise<Transport> {
  const bridge = getWebViewBridge();
  if (bridge) return new WebViewTransport(bridge);
  const runtime = (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime;
  if (runtime?.id && !new URLSearchParams(location.search).has('mock')) {
    return new RuntimePortTransport();
  }
  const { MockTransport } = await import('./mock');
  return new MockTransport();
}
