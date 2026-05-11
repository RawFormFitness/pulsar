"use client";

// components/dashboard/series-context.tsx
//
// React context that carries chart-series data from the server-side
// SeriesHydrator down to the in-section toggle components.
//
// Why context (and not props):
//   * The primary tile content streams to the page on the fast path
//     (no series needed). The series data arrives later in a separate
//     <Suspense> boundary inside <SeriesHydrator>.
//   * The toggle button itself lives inside the section header
//     (rendered immediately with the tiles), so it can't receive the
//     series via the same prop tree.
//   * Context flattens this: provider mounts at the top of the page
//     and is populated by SeriesHydrator after streaming completes;
//     subscribers (the toggle + chart) re-render when data arrives.
//
// Hydration state shape:
//   * `status: "pending"` — first paint; series is still streaming. The
//     toggle button shows a small spinner if pressed during this state
//     and waits for data to arrive.
//   * `status: "ready"` — series data is present.
//   * `status: "error"` — series fetch threw; toggle shows an inline
//     error in chart view. Tile view continues to work.
//
// Boundary discipline:
//   * No lib/db or Supabase imports. The provider receives plain
//     JSON-serializable data from the server.

import * as React from "react";
import type { SeriesPack } from "@/app/(dashboard)/_lib/series";

export type SeriesState =
  | { status: "pending" }
  | { status: "ready"; pack: SeriesPack }
  | { status: "error"; message: string };

const SeriesContext = React.createContext<SeriesState | null>(null);

/** Pre-resolved series — direct from server. Pass `state.status === "ready"`. */
type SeriesProviderProps = {
  children: React.ReactNode;
  /** Initial state. Server passes `{ status: "pending" }` on first paint;
   * SeriesHydrator swaps to `{ status: "ready" }` once the streamed
   * series resolves. */
  initial: SeriesState;
};

/** Lightweight inline subscriber — exposes a `setState` so the hydrator
 * (a server component that suspends on data) can hand the resolved
 * pack into the client tree. We avoid a full event system by using
 * a single ref-backed subscription. */
type Listener = (s: SeriesState) => void;

class SeriesStore {
  private state: SeriesState;
  private listeners = new Set<Listener>();
  constructor(initial: SeriesState) {
    this.state = initial;
  }
  get(): SeriesState {
    return this.state;
  }
  set(next: SeriesState): void {
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

const StoreContext = React.createContext<SeriesStore | null>(null);

export function SeriesProvider({ children, initial }: SeriesProviderProps) {
  // One store instance per provider mount. We deliberately don't recreate
  // it across the `initial` prop changing — series state transitions
  // happen via the imperative API exposed below.
  const storeRef = React.useRef<SeriesStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new SeriesStore(initial);
  }
  return (
    <StoreContext.Provider value={storeRef.current}>
      <ClientSubscriber store={storeRef.current}>{children}</ClientSubscriber>
    </StoreContext.Provider>
  );
}

/** Internal wrapper that re-renders subscribers when the store updates. */
function ClientSubscriber({
  store,
  children,
}: {
  store: SeriesStore;
  children: React.ReactNode;
}) {
  const state = React.useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(),
    () => store.get(),
  );
  return (
    <SeriesContext.Provider value={state}>{children}</SeriesContext.Provider>
  );
}

/** Read the current series state. Returns the pending-state literal
 * outside a provider so consumers can rely on a shape without null
 * checks. */
export function useSeries(): SeriesState {
  const ctx = React.useContext(SeriesContext);
  if (!ctx) return { status: "pending" };
  return ctx;
}

/** Imperative setter for the hydrator. Returns a no-op when called
 * outside a provider (degrades gracefully during tests / partial
 * trees). */
export function useSeriesSetter(): (s: SeriesState) => void {
  const store = React.useContext(StoreContext);
  return React.useCallback(
    (s: SeriesState) => {
      if (store) store.set(s);
    },
    [store],
  );
}
