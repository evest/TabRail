// Phase B transport: the UI runs inside WebView2; the .NET host relays to/from Chrome
// over native messaging. Host -> UI uses PostWebMessageAsJson, so event.data is already parsed.
import type { FromUi, ToUi } from '../../shared/protocol';
import { Listeners, type Transport } from './types';

export interface WebViewBridge {
  postMessage(msg: unknown): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
}

export function getWebViewBridge(): WebViewBridge | undefined {
  return (globalThis as { chrome?: { webview?: WebViewBridge } }).chrome?.webview;
}

export class WebViewTransport implements Transport {
  private readonly listeners = new Listeners<ToUi>();

  constructor(private readonly bridge: WebViewBridge) {
    bridge.addEventListener('message', (e) => this.listeners.emit(e.data as ToUi));
    this.send({ type: 'ready' });
  }

  send(msg: FromUi): void {
    this.bridge.postMessage(msg);
  }

  onMessage(cb: (msg: ToUi) => void): () => void {
    return this.listeners.add(cb);
  }
}
