import type { FromUi, ToUi } from '../../shared/protocol';

/** The only way the UI talks to the outside world (hard rule 2). */
export interface Transport {
  send(msg: FromUi): void;
  /** Returns an unsubscribe function. */
  onMessage(cb: (msg: ToUi) => void): () => void;
}

export class Listeners<T> {
  private readonly set = new Set<(v: T) => void>();
  add(cb: (v: T) => void): () => void {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(v: T): void {
    for (const cb of this.set) cb(v);
  }
}
