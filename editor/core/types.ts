/**
 * Serializable data model for the Aether Editor. These plain JSON-friendly
 * shapes are what scenes are saved/loaded as; live engine components are built
 * from them and read back into them. Angles are in DEGREES in the data model
 * (converted to radians for the engine).
 */

export type PrimitiveKind = 'box' | 'sphere' | 'plane' | 'cylinder' | 'capsule' | 'torus';
export type LightKind = 'directional' | 'point' | 'spot';
export type BodyKind = 'static' | 'dynamic';
export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type EditorMode = 'edit' | 'play';

/** Transform in editor units. Euler rotation is XYZ order, in DEGREES. */
export interface TransformData {
  position: number[]; // [x,y,z]
  rotationEuler: number[]; // [x,y,z] degrees
  scale: number[]; // [x,y,z]
}

export interface MaterialData {
  albedo: number[]; // [r,g,b] 0..1
  metallic: number;
  roughness: number;
  emissive: number[]; // [r,g,b]
  emissiveIntensity: number;
  opacity: number;
}

export interface LightData {
  kind: LightKind;
  color: number[]; // [r,g,b]
  intensity: number;
  range: number;
  castShadow: boolean;
  innerCone: number; // degrees
  outerCone: number; // degrees
}

export interface BodyData {
  kind: BodyKind;
  mass: number;
  restitution: number;
  friction: number;
}

export interface ObjectJSON {
  id: number;
  name: string;
  transform: TransformData;
  primitive?: PrimitiveKind; // present => the object has a mesh + material
  material?: MaterialData;
  light?: LightData;
  body?: BodyData;
}

export interface EnvironmentData {
  ambient: number[];
  sunColor: number[];
  sunDirection: number[]; // travel direction
  sunIntensity: number;
  sunCastShadow: boolean;
  fogColor: number[];
  fogDensity: number;
  exposure: number;
  bloom: boolean;
  bloomStrength: number;
}

export interface SceneJSON {
  version: number;
  nextId: number;
  environment: EnvironmentData;
  objects: ObjectJSON[];
}

/** Request to create a new object. */
export type AddSpec =
  | {
      kind: 'mesh';
      primitive: PrimitiveKind;
      name?: string;
      position?: number[];
      withBody?: boolean;
      bodyKind?: BodyKind;
    }
  | { kind: 'light'; lightKind: LightKind; name?: string; position?: number[] };

export const SCENE_VERSION = 1;

/** Default environment for a fresh scene. */
export function defaultEnvironment(): EnvironmentData {
  return {
    ambient: [0.16, 0.18, 0.25],
    sunColor: [1.0, 0.96, 0.9],
    sunDirection: [0.4, -0.8, -0.45],
    sunIntensity: 3.4,
    sunCastShadow: true,
    fogColor: [0.07, 0.09, 0.13],
    fogDensity: 0.0,
    exposure: 1.1,
    bloom: true,
    bloomStrength: 0.6,
  };
}

/** Default material params for a new mesh object. */
export function defaultMaterial(): MaterialData {
  return {
    albedo: [0.8, 0.8, 0.82],
    metallic: 0.0,
    roughness: 0.55,
    emissive: [0, 0, 0],
    emissiveIntensity: 1,
    opacity: 1,
  };
}

/** Default light params for a new light of the given kind. */
export function defaultLight(kind: LightKind): LightData {
  return {
    kind,
    color: [1, 1, 1],
    intensity: kind === 'directional' ? 3 : 12,
    range: 18,
    castShadow: kind === 'directional',
    innerCone: 18,
    outerCone: 26,
  };
}

/** Default body params. */
export function defaultBody(kind: BodyKind = 'dynamic'): BodyData {
  return { kind, mass: 1, restitution: 0.3, friction: 0.5 };
}
