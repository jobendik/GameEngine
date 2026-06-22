import { Vec3 } from '@/core/math';
import { VertexArray } from '@/render/gl';
import type { GL } from '@/render/gl/GLContext';

/**
 * Raw geometry attribute streams consumed by {@link Mesh}. Positions are
 * required; normals/tangents are auto-computed when absent (normals always,
 * tangents only if UVs are present). Index type may be 16- or 32-bit.
 */
export interface GeometryData {
  /** Vertex positions, packed xyz (length = vertexCount * 3). */
  positions: Float32Array;
  /** Vertex normals, packed xyz. Auto-computed (area-weighted) if absent. */
  normals?: Float32Array;
  /** Texture coordinates, packed xy. */
  uvs?: Float32Array;
  /** Tangents, packed xyzw (w = handedness). Auto-computed if absent and uvs present. */
  tangents?: Float32Array;
  /** Triangle indices (Uint16Array unless vertex count exceeds 65535). */
  indices: Uint16Array | Uint32Array;
}

/**
 * A GPU mesh: builds a {@link VertexArray} from {@link GeometryData} using the
 * fixed attribute locations (0=position, 1=normal, 2=uv, 3=tangent) and tracks
 * a local-space bounding sphere.
 *
 * Missing normals are computed (area-weighted face normals accumulated per
 * vertex then normalized) in the constructor; missing tangents are computed
 * when UVs are present.
 */
export class Mesh {
  /** The (possibly normal/tangent-augmented) geometry backing this mesh. */
  readonly data: GeometryData;
  /** The vertex array object holding the uploaded attribute buffers. */
  readonly vao: VertexArray;
  /** Local-space bounding sphere: midpoint of the AABB and max vertex distance. */
  readonly bounds: { center: Vec3; radius: number };

  private readonly gl: GL;

  constructor(gl: GL, data: GeometryData) {
    this.gl = gl;
    this.data = data;

    if (!data.normals) {
      this.computeNormals();
    }
    if (data.uvs && !data.tangents) {
      this.computeTangents();
    }

    this.bounds = { center: new Vec3(), radius: 0 };
    this.computeBounds();

    this.vao = new VertexArray(gl);
    this.vao.setAttribute(0, this.data.positions, 3);
    if (this.data.normals) this.vao.setAttribute(1, this.data.normals, 3);
    if (this.data.uvs) this.vao.setAttribute(2, this.data.uvs, 2);
    if (this.data.tangents) this.vao.setAttribute(3, this.data.tangents, 4);
    this.vao.setIndices(this.data.indices);
  }

  /**
   * Compute per-vertex normals as the normalized sum of area-weighted face
   * normals (the un-normalized cross product of two triangle edges already
   * encodes twice the face area, giving correct area weighting). Result is
   * stored into `this.data.normals`.
   */
  computeNormals(): void {
    const positions = this.data.positions;
    const indices = this.data.indices;
    const vertCount = positions.length / 3;
    const normals = new Float32Array(positions.length);

    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i] * 3;
      const ib = indices[i + 1] * 3;
      const ic = indices[i + 2] * 3;

      const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
      const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
      const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];

      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

      // Cross product (length proportional to 2x triangle area).
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
      normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
      normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
    }

    for (let v = 0; v < vertCount; v++) {
      const o = v * 3;
      const x = normals[o], y = normals[o + 1], z = normals[o + 2];
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len > 0) {
        const inv = 1 / len;
        normals[o] = x * inv;
        normals[o + 1] = y * inv;
        normals[o + 2] = z * inv;
      } else {
        normals[o] = 0;
        normals[o + 1] = 1;
        normals[o + 2] = 0;
      }
    }

    this.data.normals = normals;
  }

  /**
   * Compute per-vertex tangents (xyzw with w = handedness) from UV deltas using
   * the standard per-triangle method, accumulating into per-vertex tangent and
   * bitangent sums, then Gram-Schmidt orthonormalizing against the normal.
   * Requires UVs and normals to be present.
   */
  computeTangents(): void {
    const positions = this.data.positions;
    const uvs = this.data.uvs;
    const normals = this.data.normals;
    if (!uvs || !normals) return;

    const indices = this.data.indices;
    const vertCount = positions.length / 3;

    const tan = new Float32Array(vertCount * 3);
    const bitan = new Float32Array(vertCount * 3);

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];

      const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
      const u0 = i0 * 2, u1 = i1 * 2, u2 = i2 * 2;

      const e1x = positions[p1] - positions[p0];
      const e1y = positions[p1 + 1] - positions[p0 + 1];
      const e1z = positions[p1 + 2] - positions[p0 + 2];
      const e2x = positions[p2] - positions[p0];
      const e2y = positions[p2 + 1] - positions[p0 + 1];
      const e2z = positions[p2 + 2] - positions[p0 + 2];

      const du1 = uvs[u1] - uvs[u0];
      const dv1 = uvs[u1 + 1] - uvs[u0 + 1];
      const du2 = uvs[u2] - uvs[u0];
      const dv2 = uvs[u2 + 1] - uvs[u0 + 1];

      const denom = du1 * dv2 - du2 * dv1;
      const r = denom !== 0 ? 1 / denom : 0;

      const tx = (dv2 * e1x - dv1 * e2x) * r;
      const ty = (dv2 * e1y - dv1 * e2y) * r;
      const tz = (dv2 * e1z - dv1 * e2z) * r;

      const bx = (du1 * e2x - du2 * e1x) * r;
      const by = (du1 * e2y - du2 * e1y) * r;
      const bz = (du1 * e2z - du2 * e1z) * r;

      tan[p0] += tx; tan[p0 + 1] += ty; tan[p0 + 2] += tz;
      tan[p1] += tx; tan[p1 + 1] += ty; tan[p1 + 2] += tz;
      tan[p2] += tx; tan[p2 + 1] += ty; tan[p2 + 2] += tz;

      bitan[p0] += bx; bitan[p0 + 1] += by; bitan[p0 + 2] += bz;
      bitan[p1] += bx; bitan[p1 + 1] += by; bitan[p1 + 2] += bz;
      bitan[p2] += bx; bitan[p2 + 1] += by; bitan[p2 + 2] += bz;
    }

    const tangents = new Float32Array(vertCount * 4);
    for (let v = 0; v < vertCount; v++) {
      const o3 = v * 3;
      const o4 = v * 4;

      const nx = normals[o3], ny = normals[o3 + 1], nz = normals[o3 + 2];
      const tx = tan[o3], ty = tan[o3 + 1], tz = tan[o3 + 2];

      // Gram-Schmidt orthogonalize: t' = t - n * dot(n, t).
      const ndt = nx * tx + ny * ty + nz * tz;
      let ox = tx - nx * ndt;
      let oy = ty - ny * ndt;
      let oz = tz - nz * ndt;

      const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (len > 0) {
        const inv = 1 / len;
        ox *= inv; oy *= inv; oz *= inv;
      } else {
        // Degenerate tangent: pick an arbitrary axis orthogonal to the normal.
        if (Math.abs(nx) <= Math.abs(ny) && Math.abs(nx) <= Math.abs(nz)) {
          ox = 0; oy = -nz; oz = ny;
        } else if (Math.abs(ny) <= Math.abs(nz)) {
          ox = -nz; oy = 0; oz = nx;
        } else {
          ox = -ny; oy = nx; oz = 0;
        }
        const l2 = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
        ox /= l2; oy /= l2; oz /= l2;
      }

      // Handedness: sign of dot(cross(n, t), bitangent).
      const cx = ny * oz - nz * oy;
      const cy = nz * ox - nx * oz;
      const cz = nx * oy - ny * ox;
      const w =
        cx * bitan[o3] + cy * bitan[o3 + 1] + cz * bitan[o3 + 2] < 0 ? -1 : 1;

      tangents[o4] = ox;
      tangents[o4 + 1] = oy;
      tangents[o4 + 2] = oz;
      tangents[o4 + 3] = w;
    }

    this.data.tangents = tangents;
  }

  /** Draw the mesh as indexed triangles. */
  draw(): void {
    this.vao.draw(this.gl.TRIANGLES);
  }

  /** Draw `count` instances of the mesh (instance attributes set on the VAO). */
  drawInstanced(count: number): void {
    this.vao.drawInstanced(count, this.gl.TRIANGLES);
  }

  /** Release the underlying GPU vertex array and its buffers. */
  dispose(): void {
    this.vao.dispose();
  }

  /** Compute the local bounding sphere from the AABB midpoint + max distance. */
  private computeBounds(): void {
    const positions = this.data.positions;
    if (positions.length === 0) {
      this.bounds.center.set(0, 0, 0);
      this.bounds.radius = 0;
      return;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    this.bounds.center.set(cx, cy, cz);

    let maxSq = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i] - cx;
      const dy = positions[i + 1] - cy;
      const dz = positions[i + 2] - cz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > maxSq) maxSq = d;
    }
    this.bounds.radius = Math.sqrt(maxSq);
  }
}
