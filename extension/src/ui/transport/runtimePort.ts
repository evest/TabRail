// Phase A transport: a long-lived port to the service worker.
// This is the only UI file allowed to touch chrome.* (see eslint.config.js).
import { PORT_NAME } from '../../shared/protocol';
import type { FromUi, ToUi } from '../../shared/protocol';
import { Listeners, type Transport } from './types';

export class RuntimePortTransport implements Transport {
  private port: chrome.runtime.Port | null = null;
  private readonly listeners = new Listeners<ToUi>();
  /** Commands issued while reconnecting; flushed once the new port is up. */
  private pending: FromUi[] = [];
  private retryMs = 0;

  constructor() {
    this.connect();
  }

  send(msg: FromUi): void {
    if (!this.port) {
      this.pending.push(msg);
      return;
    }
    try {
      this.port.postMessage(msg);
    } catch {
      // Port died between the disconnect event and now.
      this.pending.push(msg);
      this.dropPort();
      this.connect();
    }
  }

  onMessage(cb: (msg: ToUi) => void): () => void {
    return this.listeners.add(cb);
  }

  /**
   * MV3 service workers get terminated when idle, which drops the port. Reconnecting wakes the
   * worker, which rebuilds its state and answers `ready` with a fresh snapshot.
   */
  private connect(): void {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      // "Extension context invalidated": the extension was reloaded, updated or disabled and this
      // page is orphaned. Reloading picks up the new version (or fails cleanly if it is gone).
      location.reload();
      return;
    }
    this.port = port;
    port.onMessage.addListener((msg: ToUi) => {
      this.retryMs = 0;
      this.listeners.emit(msg);
    });
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it as handled; otherwise Chrome reports
      // "Unchecked runtime.lastError" on the extension's Errors page.
      void chrome.runtime.lastError;
      if (this.port !== port) return;
      this.dropPort();
      this.retryMs = Math.min(this.retryMs ? this.retryMs * 2 : 50, 2000);
      setTimeout(() => this.connect(), this.retryMs);
    });
    port.postMessage({ type: 'ready' } satisfies FromUi);
    const queued = this.pending;
    this.pending = [];
    for (const msg of queued) this.send(msg);
  }

  private dropPort(): void {
    const port = this.port;
    this.port = null;
    try {
      port?.disconnect();
    } catch {
      /* already gone */
    }
  }
}
