/**
 * `@/core` barrel — the engine's foundational layer.
 *
 * Re-exports the math and ECS sub-barrels plus the core runtime primitives
 * (`Engine`, `Time`, `EventBus`) so consumers can import the whole foundation
 * from a single path.
 */
export * from './math';
export * from './ecs';

export { Engine } from './Engine';
export { Time } from './Time';
export { EventBus } from './EventBus';

export type { EngineModule, EngineOptions } from './Engine';
export type { EventListener } from './EventBus';
