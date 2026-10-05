import type { LayerTransform } from './types';

export type Matrix2D = [number, number, number, number, number, number];
export interface TransformNode {
  id: string;
  transformParentId?: string | null;
}
/** Derived render data only: never persisted in authored keys or scripts. */
export type WorldTransform = LayerTransform & { worldMatrix?: Matrix2D };
export const identityMatrix = (): Matrix2D => [1, 0, 0, 1, 0, 0];
export function multiplyMatrices(a: Matrix2D, b: Matrix2D): Matrix2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function inverseMatrix(m: Matrix2D): Matrix2D {
  const [a, b, c, d, e, f] = m,
    det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
    throw Error('Cannot invert a singular transform (zero scale).');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
export function matrixPoint(m: Matrix2D, p: { x: number; y: number }) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
export function localTransformMatrix(t: LayerTransform): Matrix2D {
  const angle = (t.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle),
    sx = t.scaleX ?? 1,
    sy = t.scaleY ?? 1,
    k = Math.tan(((t.skewX ?? 0) * Math.PI) / 180);
  const a = c * sx,
    b = s * sx,
    cc = (c * k - s) * sy,
    d = (s * k + c) * sy,
    ox = t.width * t.transformOriginX,
    oy = t.height * t.transformOriginY;
  return [a, b, cc, d, t.x + ox - a * ox - cc * oy, t.y + oy - b * ox - d * oy];
}
export function worldTransformMatrix(t: LayerTransform): Matrix2D {
  return (t as WorldTransform).worldMatrix ?? localTransformMatrix(t);
}
/** Resolve after Expressions -> Comp. Hidden parents still transform descendants; alpha does not inherit. */
export function resolveWorldTransforms(
  nodes: readonly TransformNode[],
  poses: ReadonlyMap<string, LayerTransform>,
): Map<string, WorldTransform> {
  const byId = new Map<string, TransformNode>(),
    result = new Map<string, WorldTransform>(),
    visiting = new Set<string>();
  for (const n of nodes) {
    if (byId.has(n.id)) throw Error('Duplicate transform layer: ' + n.id);
    byId.set(n.id, n);
  }
  const visit = (id: string): WorldTransform => {
    const cached = result.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw Error('Transform parent cycle: ' + id);
    const node = byId.get(id),
      pose = poses.get(id);
    if (!node || !pose) throw Error('Missing transform parent/pose: ' + id);
    visiting.add(id);
    const local = localTransformMatrix(pose);
    const matrix = node.transformParentId
      ? multiplyMatrices(worldTransformMatrix(visit(node.transformParentId)), local)
      : local;
    if (!matrix.every(Number.isFinite)) throw Error('Non-finite transform: ' + id);
    const resolved = { ...pose, worldMatrix: matrix };
    result.set(id, resolved);
    visiting.delete(id);
    return resolved;
  };
  for (const n of nodes) visit(n.id);
  return result;
}
/** Preserve an arbitrary nonsingular affine pose, including reflections and shear. */
export function poseFromMatrix(m: Matrix2D, pose: LayerTransform): LayerTransform {
  const [a, b, c, d, e, f] = m,
    sx = Math.hypot(a, b),
    det = a * d - b * c;
  if (sx < 1e-12 || Math.abs(det) < 1e-12)
    throw Error('Cannot edit a singular transform (zero scale).');
  const sy = det / sx,
    k = (a * c + b * d) / det,
    ox = pose.width * pose.transformOriginX,
    oy = pose.height * pose.transformOriginY;
  return {
    ...pose,
    x: e - ox + a * ox + c * oy,
    y: f - oy + b * ox + d * oy,
    rotation: (Math.atan2(b, a) * 180) / Math.PI,
    scaleX: sx,
    scaleY: sy,
    skewX: (Math.atan(k) * 180) / Math.PI,
  };
}
