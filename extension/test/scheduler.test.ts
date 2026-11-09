import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapshotScheduler } from '../src/background/scheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('SnapshotScheduler', () => {
  it('coalesces bursts and increments seq', () => {
    vi.useFakeTimers();
    const seqs: number[] = [];
    const s = new SnapshotScheduler(50, (seq) => seqs.push(seq));
    s.schedule();
    s.schedule();
    vi.advanceTimersByTime(49);
    expect(seqs).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seqs).toEqual([1]);
    s.schedule();
    vi.advanceTimersByTime(50);
    expect(seqs).toEqual([1, 2]);
  });
});
