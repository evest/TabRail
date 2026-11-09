/** Coalesces bursts of changes into one snapshot per `delayMs`, with a monotonically increasing seq. */
export class SnapshotScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(
    private readonly delayMs: number,
    private readonly flush: (seq: number) => void,
  ) {}

  schedule(): void {
    if (this.timer != null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush(this.nextSeq());
    }, this.delayMs);
  }

  nextSeq(): number {
    return ++this.seq;
  }
}
