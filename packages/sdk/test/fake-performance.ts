import { vi } from "vitest";

type Entry = Partial<PerformanceEntry> & Record<string, unknown>;

/** Test içinden kayıt gönderilebilen sahte PerformanceObserver. */
export class FakePerformanceObserver {
  static supportedEntryTypes: string[] = [];
  static instances: FakePerformanceObserver[] = [];

  type = "";
  options: Record<string, unknown> = {};
  disconnected = false;
  private pending: Entry[] = [];

  constructor(private readonly callback: (list: { getEntries: () => Entry[] }) => void) {
    FakePerformanceObserver.instances.push(this);
  }

  observe(options: { type: string } & Record<string, unknown>) {
    this.type = options.type;
    this.options = options;
  }

  disconnect() {
    this.disconnected = true;
  }

  takeRecords(): Entry[] {
    const records = this.pending;
    this.pending = [];
    return records;
  }

  /** Kayıtları callback'e iletir (tarayıcının asenkron teslimatı gibi). */
  deliver(entries: Entry[]) {
    if (!this.disconnected) this.callback({ getEntries: () => entries });
  }

  /** Kayıtları sadece takeRecords() ile alınacak şekilde bekletir. */
  queue(entries: Entry[]) {
    this.pending.push(...entries);
  }
}

export function emit(type: string, entries: Entry[]) {
  for (const po of FakePerformanceObserver.instances.filter((o) => o.type === type)) po.deliver(entries);
}

export function observerFor(type: string) {
  return FakePerformanceObserver.instances.find((o) => o.type === type);
}

interface FakeOptions {
  supported?: string[];
  navigation?: Record<string, unknown>;
  interactionCount?: number;
  now?: number;
}

export function installFakePerformance(options: FakeOptions = {}) {
  FakePerformanceObserver.supportedEntryTypes = options.supported ?? [
    "paint",
    "largest-contentful-paint",
    "layout-shift",
    "event",
    "first-input",
  ];
  FakePerformanceObserver.instances = [];
  vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
  vi.spyOn(performance, "now").mockReturnValue(options.now ?? 10_000);
  vi.spyOn(performance, "getEntriesByType").mockImplementation((type: string) =>
    type === "navigation" && options.navigation ? ([options.navigation] as unknown as PerformanceEntryList) : [],
  );
  if (options.interactionCount !== undefined) {
    Object.defineProperty(performance, "interactionCount", { configurable: true, value: options.interactionCount });
  }
}

export function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}
