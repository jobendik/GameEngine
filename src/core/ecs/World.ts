/**
 * Data-oriented sparse-set ECS.
 *
 * Each component CLASS owns a {@link ComponentStore} holding a dense array of
 * instances packed next to a parallel dense array of owning entity ids, plus a
 * sparse map (entity -> dense index) for O(1) lookup/add/remove. Removal is a
 * swap-remove so the dense arrays stay tightly packed and cache-friendly.
 *
 * Entity ids are small integers; `0` is reserved as the INVALID/null entity.
 * Ids are recycled through a free list once destroyed.
 */

/** An entity handle. `0` is the INVALID / null entity. */
export type Entity = number;

/**
 * A component is any class. Registration into the world is implicit on the
 * first {@link World.add} of that class.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComponentClass<T = any> = new (...args: any[]) => T;

/**
 * Packed storage for a single component type. Internal to {@link World}.
 *
 * Invariants:
 * - `instances[i]` belongs to entity `entities[i]`.
 * - `sparse.get(entity)` is the dense index `i` for that entity, if present.
 */
class ComponentStore<T> {
  /** Dense array of component instances. */
  readonly instances: T[] = [];
  /** Dense array of owning entity ids, parallel to {@link instances}. */
  readonly entities: Entity[] = [];
  /** Sparse map: entity id -> dense index into the arrays above. */
  readonly sparse = new Map<Entity, number>();

  /** Number of components currently stored. */
  get size(): number {
    return this.instances.length;
  }

  /** Whether `entity` has a component in this store. */
  has(entity: Entity): boolean {
    return this.sparse.has(entity);
  }

  /** Return the component for `entity`, or `undefined` if absent. */
  get(entity: Entity): T | undefined {
    const i = this.sparse.get(entity);
    return i === undefined ? undefined : this.instances[i];
  }

  /**
   * Attach `component` to `entity`. If the entity already has one it is
   * overwritten in place. Returns the stored component.
   */
  set(entity: Entity, component: T): T {
    const existing = this.sparse.get(entity);
    if (existing !== undefined) {
      this.instances[existing] = component;
      return component;
    }
    this.sparse.set(entity, this.instances.length);
    this.instances.push(component);
    this.entities.push(entity);
    return component;
  }

  /**
   * Remove the component owned by `entity` via swap-remove. No-op if absent.
   * Keeps the dense arrays packed by moving the last element into the hole.
   */
  remove(entity: Entity): void {
    const i = this.sparse.get(entity);
    if (i === undefined) return;
    const last = this.instances.length - 1;
    if (i !== last) {
      const movedEntity = this.entities[last]!;
      this.instances[i] = this.instances[last]!;
      this.entities[i] = movedEntity;
      this.sparse.set(movedEntity, i);
    }
    this.instances.pop();
    this.entities.pop();
    this.sparse.delete(entity);
  }
}

/**
 * The ECS world: owns entities and their component stores, and provides the
 * cache-friendly {@link World.query} iteration used by systems.
 */
export class World {
  /** Component-class -> its packed store. Stores are created on first use. */
  private readonly stores = new Map<ComponentClass, ComponentStore<unknown>>();
  /** Live-entity membership set (entity id -> alive). */
  private readonly alive = new Set<Entity>();
  /** Recyclable entity ids freed by {@link destroyEntity}. */
  private readonly freeList: Entity[] = [];
  /** Next fresh id to hand out when the free list is empty. Ids start at 1. */
  private nextId: Entity = 1;

  /**
   * Allocate a new entity id. Recycles freed ids when available; otherwise
   * hands out a fresh incrementing id starting at 1 (0 is never returned).
   */
  createEntity(): Entity {
    const id = this.freeList.length > 0 ? this.freeList.pop()! : this.nextId++;
    this.alive.add(id);
    return id;
  }

  /**
   * Destroy `entity`, removing it from every component store (swap-remove) and
   * returning its id to the free list. No-op if the entity is not alive.
   */
  destroyEntity(entity: Entity): void {
    if (!this.alive.has(entity)) return;
    for (const store of this.stores.values()) store.remove(entity);
    this.alive.delete(entity);
    this.freeList.push(entity);
  }

  /** Whether `entity` currently exists. The null entity (0) is never alive. */
  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  /**
   * Attach a component instance to `entity`. The component's class is inferred
   * from its constructor, registering a store on first use. Returns the
   * instance for convenient chaining.
   */
  add<T extends object>(entity: Entity, component: T): T {
    const type = (component as { constructor: ComponentClass<T> }).constructor;
    return this.storeFor(type).set(entity, component);
  }

  /** Return `entity`'s component of `type`, or `undefined` if it has none. */
  get<T>(entity: Entity, type: ComponentClass<T>): T | undefined {
    const store = this.stores.get(type) as ComponentStore<T> | undefined;
    return store?.get(entity);
  }

  /**
   * Return `entity`'s component of `type`, throwing if it is missing. Use when
   * the component is a required invariant of the calling system.
   */
  getOr<T>(entity: Entity, type: ComponentClass<T>): T {
    const c = this.get(entity, type);
    if (c === undefined) {
      throw new Error(
        `World.getOr: entity ${entity} has no component ${type.name || '<anonymous>'}`,
      );
    }
    return c;
  }

  /** Whether `entity` has a component of `type`. */
  has(entity: Entity, type: ComponentClass): boolean {
    return this.stores.get(type)?.has(entity) ?? false;
  }

  /** Remove `entity`'s component of `type` (swap-remove). No-op if absent. */
  remove(entity: Entity, type: ComponentClass): void {
    this.stores.get(type)?.remove(entity);
  }

  /**
   * Iterate every entity that has ALL of the listed component types, invoking
   * `fn(entity, ...components)` with the components in the same order as the
   * types. Iterates the SMALLEST matching store and probes the rest via `has`,
   * so cost scales with the rarest component, not the largest.
   */
  query<A>(a: ComponentClass<A>, fn: (e: Entity, a: A) => void): void;
  query<A, B>(
    a: ComponentClass<A>,
    b: ComponentClass<B>,
    fn: (e: Entity, a: A, b: B) => void,
  ): void;
  query<A, B, C>(
    a: ComponentClass<A>,
    b: ComponentClass<B>,
    c: ComponentClass<C>,
    fn: (e: Entity, a: A, b: B, c: C) => void,
  ): void;
  query<A, B, C, D>(
    a: ComponentClass<A>,
    b: ComponentClass<B>,
    c: ComponentClass<C>,
    d: ComponentClass<D>,
    fn: (e: Entity, a: A, b: B, c: C, d: D) => void,
  ): void;
  query(...args: unknown[]): void {
    const fn = args[args.length - 1] as (e: Entity, ...rest: unknown[]) => void;
    const types = args.slice(0, -1) as ComponentClass[];

    // Resolve stores; if any type was never used, no entity can match.
    const stores: ComponentStore<unknown>[] = [];
    for (const type of types) {
      const store = this.stores.get(type);
      if (store === undefined || store.size === 0) return;
      stores.push(store);
    }

    // Pick the smallest store as the driver so we iterate the fewest entities.
    let driver = 0;
    for (let i = 1; i < stores.length; i++) {
      if (stores[i]!.size < stores[driver]!.size) driver = i;
    }
    const driverStore = stores[driver]!;

    // Iterate a snapshot length so callbacks may safely mutate the driver store
    // (e.g. removing the current component) without skipping elements.
    const driverEntities = driverStore.entities;
    const components: unknown[] = new Array(types.length);
    for (let d = driverStore.size - 1; d >= 0; d--) {
      const e = driverEntities[d]!;
      let ok = true;
      for (let i = 0; i < stores.length; i++) {
        const c = stores[i]!.get(e);
        if (c === undefined) {
          ok = false;
          break;
        }
        components[i] = c;
      }
      if (ok) fn(e, ...components);
    }
  }

  /**
   * Return a fresh array of every entity having ALL listed component types.
   * Allocates — prefer {@link World.query} in hot paths.
   */
  entitiesWith(...types: ComponentClass[]): Entity[] {
    const result: Entity[] = [];
    if (types.length === 0) return result;

    const stores: ComponentStore<unknown>[] = [];
    for (const type of types) {
      const store = this.stores.get(type);
      if (store === undefined || store.size === 0) return result;
      stores.push(store);
    }

    let driver = 0;
    for (let i = 1; i < stores.length; i++) {
      if (stores[i]!.size < stores[driver]!.size) driver = i;
    }
    const driverStore = stores[driver]!;

    outer: for (const e of driverStore.entities) {
      for (let i = 0; i < stores.length; i++) {
        if (i !== driver && !stores[i]!.has(e)) continue outer;
      }
      result.push(e);
    }
    return result;
  }

  /** Number of live components of `type` (0 if the type was never used). */
  count(type: ComponentClass): number {
    return this.stores.get(type)?.size ?? 0;
  }

  /**
   * Remove all entities and components, resetting id allocation. After this the
   * next {@link createEntity} returns 1 again.
   */
  clear(): void {
    this.stores.clear();
    this.alive.clear();
    this.freeList.length = 0;
    this.nextId = 1;
  }

  /** Get (lazily creating) the typed store for a component class. */
  private storeFor<T>(type: ComponentClass<T>): ComponentStore<T> {
    let store = this.stores.get(type) as ComponentStore<T> | undefined;
    if (store === undefined) {
      store = new ComponentStore<T>();
      this.stores.set(type, store as ComponentStore<unknown>);
    }
    return store;
  }
}
