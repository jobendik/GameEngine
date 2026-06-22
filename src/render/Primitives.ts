import type { GeometryData } from './Mesh';

/**
 * Choose the smallest index array type that can address `vertexCount` vertices:
 * Uint16Array when it fits in 65535, otherwise Uint32Array.
 */
function makeIndices(indices: number[], vertexCount: number): Uint16Array | Uint32Array {
  return vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
}

/**
 * Procedural primitive geometry generators. Each returns CPU-side
 * {@link GeometryData} (no GL resources) with positions, normals, uvs and
 * indices. Winding is counter-clockwise (front-facing) under the engine's
 * right-handed, Y-up convention.
 */
export const Primitives = {
  /**
   * Axis-aligned box centered at the origin. Each of the six faces has its own
   * vertices so normals and UVs are per-face (hard edges).
   */
  box(w = 1, h = 1, d = 1): GeometryData {
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Each face: 4 corners (CCW seen from outside), normal, and a quad.
    const addFace = (
      ax: number, ay: number, az: number, // corner 0
      bx: number, by: number, bz: number, // corner 1
      cx: number, cy: number, cz: number, // corner 2
      dx: number, dy: number, dz: number, // corner 3
      nx: number, ny: number, nz: number,
    ): void => {
      const base = positions.length / 3;
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      for (let i = 0; i < 4; i++) normals.push(nx, ny, nz);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    // +X face (normal +X), CCW when viewed from +X looking toward -X.
    addFace(
      hx, -hy, hz, hx, -hy, -hz, hx, hy, -hz, hx, hy, hz,
      1, 0, 0,
    );
    // -X face
    addFace(
      -hx, -hy, -hz, -hx, -hy, hz, -hx, hy, hz, -hx, hy, -hz,
      -1, 0, 0,
    );
    // +Y face (top)
    addFace(
      -hx, hy, hz, hx, hy, hz, hx, hy, -hz, -hx, hy, -hz,
      0, 1, 0,
    );
    // -Y face (bottom)
    addFace(
      -hx, -hy, -hz, hx, -hy, -hz, hx, -hy, hz, -hx, -hy, hz,
      0, -1, 0,
    );
    // +Z face (front)
    addFace(
      -hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz,
      0, 0, 1,
    );
    // -Z face (back)
    addFace(
      hx, -hy, -hz, -hx, -hy, -hz, -hx, hy, -hz, hx, hy, -hz,
      0, 0, -1,
    );

    const vertexCount = positions.length / 3;
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: makeIndices(indices, vertexCount),
    };
  },

  /**
   * UV-sphere centered at the origin. `segments` controls the number of
   * longitudinal divisions; latitudinal divisions are `segments / 2` (min 2).
   */
  sphere(radius = 0.5, segments = 32): GeometryData {
    const widthSegs = Math.max(3, Math.floor(segments));
    const heightSegs = Math.max(2, Math.floor(segments / 2));

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let y = 0; y <= heightSegs; y++) {
      const v = y / heightSegs;
      const theta = v * Math.PI; // 0 at top (+Y) to PI at bottom (-Y)
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      for (let x = 0; x <= widthSegs; x++) {
        const u = x / widthSegs;
        const phi = u * Math.PI * 2;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        const nx = -sinTheta * cosPhi;
        const ny = cosTheta;
        const nz = sinTheta * sinPhi;

        positions.push(nx * radius, ny * radius, nz * radius);
        normals.push(nx, ny, nz);
        uvs.push(u, 1 - v);
      }
    }

    const rowStride = widthSegs + 1;
    for (let y = 0; y < heightSegs; y++) {
      for (let x = 0; x < widthSegs; x++) {
        const a = y * rowStride + x;
        const b = a + rowStride;
        // CCW winding when viewed from outside.
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }

    const vertexCount = positions.length / 3;
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: makeIndices(indices, vertexCount),
    };
  },

  /**
   * Flat plane in the XZ plane with a +Y normal, centered at the origin and
   * subdivided into `segs` x `segs` quads.
   */
  plane(w = 1, d = 1, segs = 1): GeometryData {
    const cols = Math.max(1, Math.floor(segs));
    const rows = Math.max(1, Math.floor(segs));
    const hw = w / 2;
    const hd = d / 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      const z = -hd + v * d;
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const x = -hw + u * w;
        positions.push(x, 0, z);
        normals.push(0, 1, 0);
        uvs.push(u, 1 - v);
      }
    }

    const rowStride = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * rowStride + c;
        const b = a + rowStride;
        // CCW when viewed from +Y (above).
        indices.push(a, a + 1, b);
        indices.push(a + 1, b + 1, b);
      }
    }

    const vertexCount = positions.length / 3;
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: makeIndices(indices, vertexCount),
    };
  },

  /**
   * Cylinder aligned to the local Y axis, centered at the origin, with flat top
   * and bottom caps. `segments` is the number of radial divisions.
   */
  cylinder(radius = 0.5, height = 1, segments = 32): GeometryData {
    const radial = Math.max(3, Math.floor(segments));
    const halfH = height / 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // --- Side wall (two rings, duplicated seam vertex for correct UVs) ---
    const sideStart = positions.length / 3;
    for (let y = 0; y <= 1; y++) {
      const py = -halfH + y * height;
      for (let i = 0; i <= radial; i++) {
        const u = i / radial;
        const phi = u * Math.PI * 2;
        const cx = Math.cos(phi);
        const sz = Math.sin(phi);
        positions.push(cx * radius, py, sz * radius);
        normals.push(cx, 0, sz);
        uvs.push(u, y);
      }
    }
    const ring = radial + 1;
    for (let i = 0; i < radial; i++) {
      const a = sideStart + i;
      const b = sideStart + i + ring;
      // CCW from outside.
      indices.push(a, b, a + 1);
      indices.push(a + 1, b, b + 1);
    }

    // --- Caps ---
    const addCap = (py: number, ny: number): void => {
      const centerIdx = positions.length / 3;
      positions.push(0, py, 0);
      normals.push(0, ny, 0);
      uvs.push(0.5, 0.5);

      const rimStart = positions.length / 3;
      for (let i = 0; i <= radial; i++) {
        const u = i / radial;
        const phi = u * Math.PI * 2;
        const cx = Math.cos(phi);
        const sz = Math.sin(phi);
        positions.push(cx * radius, py, sz * radius);
        normals.push(0, ny, 0);
        uvs.push(cx * 0.5 + 0.5, sz * 0.5 + 0.5);
      }
      for (let i = 0; i < radial; i++) {
        const a = rimStart + i;
        const b = rimStart + i + 1;
        if (ny > 0) {
          // Top cap CCW viewed from above (+Y).
          indices.push(centerIdx, a, b);
        } else {
          // Bottom cap CCW viewed from below (-Y).
          indices.push(centerIdx, b, a);
        }
      }
    };
    addCap(halfH, 1);
    addCap(-halfH, -1);

    const vertexCount = positions.length / 3;
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: makeIndices(indices, vertexCount),
    };
  },

  /**
   * Capsule aligned to the local Y axis: a cylindrical body of the given
   * `height` (the straight section between the hemisphere centers) capped by two
   * hemispheres of the given `radius`. `segments` controls radial resolution.
   */
  capsule(radius = 0.5, height = 1, segments = 32): GeometryData {
    const radial = Math.max(3, Math.floor(segments));
    const rings = Math.max(2, Math.floor(segments / 4)); // rings per hemisphere
    const halfH = height / 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Total vertical rings: top hemisphere (rings+1) + bottom hemisphere (rings+1).
    // We generate continuous rings from top pole to bottom pole, offsetting the
    // hemisphere centers by ±halfH so the cylinder body is the straight span.
    const rowRings: number[] = []; // index of first vertex in each ring row
    let rowCount = 0;

    const pushRing = (cy: number, sinPhiV: number, cosPhiV: number, vCoord: number): void => {
      rowRings[rowCount++] = positions.length / 3;
      for (let i = 0; i <= radial; i++) {
        const u = i / radial;
        const phi = u * Math.PI * 2;
        const cx = Math.cos(phi) * sinPhiV;
        const sz = Math.sin(phi) * sinPhiV;
        const nx = cx;
        const ny = cosPhiV;
        const nz = sz;
        positions.push(nx * radius, cy + ny * radius, nz * radius);
        normals.push(nx, ny, nz);
        uvs.push(u, vCoord);
      }
    };

    // Top hemisphere: latitude 0 (pole, +Y) down to equator.
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const lat = (t * Math.PI) / 2; // 0..PI/2
      const cosLat = Math.cos(lat); // 1..0 (this is the +Y component)
      const sinLat = Math.sin(lat); // 0..1 (radial spread)
      pushRing(halfH, sinLat, cosLat, t * 0.25);
    }
    // Bottom hemisphere: equator down to pole (-Y).
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const lat = Math.PI / 2 + (t * Math.PI) / 2; // PI/2..PI
      const cosLat = Math.cos(lat); // 0..-1
      const sinLat = Math.sin(lat); // 1..0
      pushRing(-halfH, sinLat, cosLat, 0.75 + t * 0.25);
    }

    // Connect every adjacent pair of rings into a quad strip.
    for (let r = 0; r < rowCount - 1; r++) {
      const cur = rowRings[r];
      const nxt = rowRings[r + 1];
      for (let i = 0; i < radial; i++) {
        const a = cur + i;
        const b = nxt + i;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }

    const vertexCount = positions.length / 3;
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: makeIndices(indices, vertexCount),
    };
  },

  /**
   * Torus lying in the XZ plane (axis = local Y), centered at the origin.
   * `radius` is the distance from center to tube center; `tube` is the tube
   * radius. `seg` and `tubeSeg` control the major/minor resolution.
   */
  torus(radius = 0.5, tube = 0.2, seg = 32, tubeSeg = 16): GeometryData {
    const majorSegs = Math.max(3, Math.floor(seg));
    const minorSegs = Math.max(3, Math.floor(tubeSeg));

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let j = 0; j <= majorSegs; j++) {
      const u = j / majorSegs;
      const phi = u * Math.PI * 2; // around the main ring
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      // Center of the tube cross-section, in the XZ plane.
      const cx = radius * cosPhi;
      const cz = radius * sinPhi;

      for (let i = 0; i <= minorSegs; i++) {
        const v = i / minorSegs;
        const theta = v * Math.PI * 2; // around the tube
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        // Tube point: offset from the ring center outward and along +Y.
        const nx = cosTheta * cosPhi;
        const ny = sinTheta;
        const nz = cosTheta * sinPhi;

        positions.push(cx + tube * nx, tube * ny, cz + tube * nz);
        normals.push(nx, ny, nz);
        uvs.push(u, v);
      }
    }

    const stride = minorSegs + 1;
    for (let j = 0; j < majorSegs; j++) {
      for (let i = 0; i < minorSegs; i++) {
        const a = j * stride + i;
        const b = (j + 1) * stride + i;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }

    const vertexCount = positions.length / 3;
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: makeIndices(indices, vertexCount),
    };
  },
};
