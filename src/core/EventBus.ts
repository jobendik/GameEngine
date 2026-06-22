/** Listener signature for {@link EventBus} events. */
export type EventListener = (payload?: unknown) => void;

/**
 * Minimal string-keyed publish/subscribe bus.
 *
 * Listeners are invoked synchronously in registration order. The set of
 * listeners is snapshotted before each emit, so it is safe to subscribe or
 * unsubscribe (including the listener removing itself) from inside a handler
 * without skipping or double-invoking other listeners during that emit.
 */
export class EventBus {
  private readonly _listeners = new Map<string, EventListener[]>();

  /**
   * Subscribe to an event.
   * @returns An unsubscribe function that removes this exact listener.
   */
  on(event: string, fn: EventListener): () => void {
    let list = this._listeners.get(event);
    if (!list) {
      list = [];
      this._listeners.set(event, list);
    }
    list.push(fn);
    return () => this.off(event, fn);
  }

  /** Remove a previously-registered listener (first matching reference). */
  off(event: string, fn: EventListener): void {
    const list = this._listeners.get(event);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
    if (list.length === 0) this._listeners.delete(event);
  }

  /** Synchronously dispatch `payload` to every listener of `event`. */
  emit(event: string, payload?: unknown): void {
    const list = this._listeners.get(event);
    if (!list || list.length === 0) return;
    // Iterate a copy so listeners may safely mutate the subscription list.
    const snapshot = list.slice();
    for (let i = 0; i < snapshot.length; i++) {
      snapshot[i](payload);
    }
  }

  /** Remove all listeners for all events. */
  clear(): void {
    this._listeners.clear();
  }
}
