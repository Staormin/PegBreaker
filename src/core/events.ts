// core/events.ts — propriétaire : architecte. Bus d'événements typé.
import type { GameEvent } from './types';

export type EventType = GameEvent['type'];
export type EventOf<T extends EventType> = Extract<GameEvent, { type: T }>;
export type Handler<T extends EventType> = (event: EventOf<T>) => void;
export type Unsubscribe = () => void;

export interface EventBus {
  on<T extends EventType>(type: T, handler: Handler<T>): Unsubscribe;
  /** Reçoit tous les événements (debug, QA). */
  onAny(handler: (event: GameEvent) => void): Unsubscribe;
  emit(event: GameEvent): void;
}

export function createEventBus(): EventBus {
  const handlers = new Map<EventType, Set<(e: GameEvent) => void>>();
  const any = new Set<(e: GameEvent) => void>();
  return {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      const h = handler as (e: GameEvent) => void;
      set.add(h);
      return () => set!.delete(h);
    },
    onAny(handler) {
      any.add(handler);
      return () => any.delete(handler);
    },
    emit(event) {
      const set = handlers.get(event.type);
      if (set) for (const h of set) h(event);
      for (const h of any) h(event);
    },
  };
}
