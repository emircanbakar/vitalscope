import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventBuffer } from "../src/buffer.js";
import { fakeSink, storedEvents } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("event buffer", () => {
  it("writes once per interval as a single batch", async () => {
    const fake = fakeSink();
    const buffer = createEventBuffer(fake.sink, { flushIntervalMs: 1000 });
    buffer.add(storedEvents(2));
    buffer.add(storedEvents(3));
    expect(fake.batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.batches.map((b) => b.length)).toEqual([5]);
    expect(buffer.stats().size).toBe(0);
  });

  it("writes immediately at the batch size", async () => {
    const fake = fakeSink();
    const buffer = createEventBuffer(fake.sink, { flushAt: 3 });
    buffer.add(storedEvents(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.written()).toHaveLength(3);
  });

  it("drops events over the limit and counts them", () => {
    const buffer = createEventBuffer(fakeSink().sink, { maxSize: 5, flushAt: 100 });
    expect(buffer.add(storedEvents(4))).toBe(4);
    expect(buffer.add(storedEvents(4))).toBe(1);
    expect(buffer.stats()).toEqual({ size: 5, dropped: 3 });
  });

  it("keeps events after a failed write and retries with growing delays", async () => {
    const fake = fakeSink();
    const write = vi.spyOn(fake.sink, "write");
    fake.fail(true);
    const buffer = createEventBuffer(fake.sink, { flushIntervalMs: 1000, maxBackoffMs: 4000 });
    buffer.add(storedEvents(2));

    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(buffer.stats().size).toBe(2);
    // 1. hatadan sonra 2 sn, 2. hatadan sonra 4 sn; sonrası sınırda kalır.
    await vi.advanceTimersByTimeAsync(1999);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(write).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(write).toHaveBeenCalledTimes(4);

    fake.fail(false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fake.written()).toHaveLength(2);
    expect(buffer.stats()).toEqual({ size: 0, dropped: 0 });
  });

  it("retries a failed batch unchanged and writes newer events separately", async () => {
    const fake = fakeSink();
    const write = vi.spyOn(fake.sink, "write");
    fake.fail(true);
    const buffer = createEventBuffer(fake.sink, { flushIntervalMs: 1000 });
    buffer.add(storedEvents(2));
    await vi.advanceTimersByTimeAsync(1000);
    buffer.add(storedEvents(1));
    fake.fail(false);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(write.mock.calls.map(([events]) => events.length)).toEqual([2, 2, 1]);
    expect(write.mock.calls[1]?.[0]).toBe(write.mock.calls[0]?.[0]);
    expect(buffer.stats()).toEqual({ size: 0, dropped: 0 });
  });

  it("counts a failed batch against the limit", async () => {
    const fake = fakeSink();
    fake.fail(true);
    const buffer = createEventBuffer(fake.sink, { maxSize: 3, flushAt: 100 });
    buffer.add(storedEvents(2));
    await buffer.flush();
    expect(buffer.add(storedEvents(2))).toBe(1);
    expect(buffer.stats()).toEqual({ size: 3, dropped: 1 });
  });

  it("does not shorten the backoff when events arrive during a failing write", async () => {
    const fake = fakeSink();
    const write = vi.spyOn(fake.sink, "write");
    fake.fail(true);
    const buffer = createEventBuffer(fake.sink, { flushIntervalMs: 1000 });
    buffer.add(storedEvents(1));
    await vi.advanceTimersByTimeAsync(1000);
    buffer.add(storedEvents(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("stays within the limit when a failed batch returns to a full queue", async () => {
    const fake = fakeSink();
    fake.hold();
    const buffer = createEventBuffer(fake.sink, { maxSize: 3, flushAt: 100 });
    buffer.add(storedEvents(3));
    const writing = buffer.flush();
    await vi.advanceTimersByTimeAsync(0);
    buffer.add(storedEvents(2));
    fake.fail(true);
    fake.release();
    await writing;
    expect(buffer.stats()).toEqual({ size: 3, dropped: 2 });
  });

  it("runs one write at a time", async () => {
    const fake = fakeSink();
    fake.hold();
    const write = vi.spyOn(fake.sink, "write");
    const buffer = createEventBuffer(fake.sink);
    buffer.add(storedEvents(1));
    const first = buffer.flush();
    buffer.add(storedEvents(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(1);
    fake.release();
    await first;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.written()).toHaveLength(2);
  });

  describe("drain", () => {
    it("writes what is left and reports nothing lost", async () => {
      const fake = fakeSink();
      const buffer = createEventBuffer(fake.sink);
      buffer.add(storedEvents(3));
      await expect(buffer.drain(1000)).resolves.toBe(0);
      expect(fake.written()).toHaveLength(3);
    });

    it("retries during the timeout", async () => {
      const fake = fakeSink();
      fake.fail(true);
      const buffer = createEventBuffer(fake.sink);
      buffer.add(storedEvents(3));
      const lost = buffer.drain(5000);
      await vi.advanceTimersByTimeAsync(300);
      fake.fail(false);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(lost).resolves.toBe(0);
      expect(fake.written()).toHaveLength(3);
    });

    it("gives up at the timeout and counts what was lost", async () => {
      const fake = fakeSink();
      fake.fail(true);
      const buffer = createEventBuffer(fake.sink);
      buffer.add(storedEvents(3));
      const lost = buffer.drain(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(lost).resolves.toBe(3);
      expect(buffer.stats()).toEqual({ size: 0, dropped: 3 });
    });

    it("counts a write that does not finish in time as lost", async () => {
      const fake = fakeSink();
      fake.hold();
      const buffer = createEventBuffer(fake.sink);
      buffer.add(storedEvents(2));
      const lost = buffer.drain(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(lost).resolves.toBe(2);
    });

    it("stops the regular timer", async () => {
      const fake = fakeSink();
      const write = vi.spyOn(fake.sink, "write");
      const buffer = createEventBuffer(fake.sink);
      await buffer.drain(0);
      buffer.add(storedEvents(1));
      await vi.advanceTimersByTimeAsync(5000);
      expect(write).not.toHaveBeenCalled();
    });
  });
});
