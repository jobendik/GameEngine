/**
 * Public barrel for the physics module — `@/physics`.
 *
 * An impulse-based 3D rigid body engine: {@link PhysicsWorld} drives
 * integration, broadphase (uniform spatial hash), narrowphase collision
 * detection (sphere/box/plane/capsule) and a sequential-impulse solver tuned
 * for stable resting stacks. {@link RigidBody} is the unit of simulation.
 */
export { PhysicsWorld } from './PhysicsWorld';
export { RigidBody, BodyType } from './RigidBody';
export type { ColliderShape, RaycastHit } from './RigidBody';
