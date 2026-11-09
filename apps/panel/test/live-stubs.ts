import { act } from "react";
import { vi } from "vitest";

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, () => void>();
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
  }
  emit(type: string) {
    act(() => this.listeners.get(type)?.());
  }
}

/** Aynı adı kullanan diğer kanallara iletir, kendisine değil; gerçek `BroadcastChannel` gibi. */
class FakeBroadcastChannel {
  static open = new Set<FakeBroadcastChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() {
    FakeBroadcastChannel.open.add(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeBroadcastChannel.open) {
      if (other !== this) other.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {
    FakeBroadcastChannel.open.delete(this);
  }
}

/** Tek sahipli kilit: bırakılınca sıradaki alır, sıradaki iptal edilirse atlanır. */
function fakeLocks() {
  type Waiter = { callback: () => Promise<void>; signal: AbortSignal; resolve: () => void; reject: (reason: unknown) => void };
  const queue: Waiter[] = [];
  let held = false;
  function next() {
    if (held) return;
    const waiter = queue.shift();
    if (!waiter) return;
    held = true;
    void waiter.callback().then(() => {
      held = false;
      waiter.resolve();
      next();
    });
  }
  return {
    request(_name: string, { signal }: { signal: AbortSignal }, callback: () => Promise<void>) {
      return new Promise<void>((resolve, reject) => {
        const waiter = { callback, signal, resolve, reject };
        queue.push(waiter);
        signal.addEventListener("abort", () => {
          const index = queue.indexOf(waiter);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(signal.reason);
          }
        });
        next();
      });
    },
  };
}

export function stubLive() {
  FakeEventSource.instances = [];
  FakeBroadcastChannel.open = new Set();
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  Object.defineProperty(navigator, "locks", { configurable: true, value: fakeLocks() });
}
