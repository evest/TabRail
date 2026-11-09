// Phase A transport: a long-lived port to the service worker.
// This is the only UI file allowed to touch chrome.* (see eslint.config.js).
import { PORT_NAME } from '../../shared/protocol';
import type { FromUi, ToUi } from '../../shared/protocol';
import { Listeners, type Transport } from './types';

export class RuntimePortTransport implements Transport {
  private port: chrome.runtime.Port | null = null;
  private readonly listeners = new Listeners<ToUi>();
  private retryMs = 0;

  constructor() {
    this.connect();
  }

  send(msg: FromUi): void {
    try {
      this.port?.postMessage(msg);
    } catch {
      this.port = null;
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
    const port = chrome.runtime.connect({ name: PORT_NAME });
    this.port = port;
    port.onMessage.addListener((msg: ToUi) => {
      this.retryMs = 0;
      this.listeners.emit(msg);
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      this.retryMs = Math.min(this.retryMs ? this.retryMs * 2 : 50, 2000);
      setTimeout(() => this.connect(), this.retryMs);
    });
    port.postMessage({ type: 'ready' } satisfies FromUi);
  }
}
