import { createEmptyRvmStageModel } from '../contracts/StageFactory.js';
import { addStageDiagnostic } from '../contracts/StageDiagnostics.js';

export const ATT_MANAGED_HIERARCHY_TO_STAGE_MODEL_VERSION = '20260703-att-managed-hierarchy-to-stage-model-v3-fitting-recipes';

const DEFAULT_RADIUS_MM = 25;
const MIN_SEGMENT_LENGTH_MM = 1;
const IDENTITY_MATRIX_3X4 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);

// ATT-managed hierarchy exports carry attribute/position data (APOS/LPOS/POS, bore, DTXR) but no
// facet/mesh geometry. This converter builds a schematic RvmStageModel.v1: real hierarchy +
// attributes for the tree/property panel, plus per-component procedural geometry decomposed along
// each fitting's APOS->LPOS span - straight pipe cylinders, curved elbow arcs, weld-neck/blind
// flange cones+discs, reducer cones, multi-part ball/globe valves, tee run+branch stubs, gasket
// discs, olet stubs and support shoes. The recipe shapes are adapted from the 3DMarkupTool
// managed-stage piping component recipes (endpoint-locked, bore-scaled role primitives). This is a
// reasonable engineering schematic derived directly from exported positions - not exact native
// geometry. Import the RVM binary through the evidence pipeline for true native geometry.
export function buildStageModelFromAttManagedHierarchy(tree, options = {}) {
  const model = createEmptyRvmStageModel({
    fileName: options.fileName || '',
    fileSize: Number(options.fileSize) || 0,
    fileHash: options.fileHash || '',
    units: 'mm',
    coordinateBasis: 'att-managed-hierarchy',
  });
  model.source.kind = 'att-managed-hierarchy';
  model.source.attAvailable = true;
  model.source.semanticSource = 'att-only';
  const { nodes, primitives } = flattenAttTree(Array.isArray(tree) ? tree : [], model.hierarchy.rootId);
  model.hierarchy.nodes = nodes;
  model.primitives = primitives;
  model.diagnostics = addStageDiagnostic(model.diagnostics, primitives.length
    ? {
        severity: 'info',
        code: 'STAGE_ATT_HIERARCHY_SCHEMATIC_GEOMETRY',
        message: `Source is an ATT-managed hierarchy export with no facet/mesh data. ${primitives.length} schematic primitives were derived from exported APOS/LPOS/POS/bore/DTXR attributes (procedural pipe, elbow, flange, reducer, valve, tee, gasket, olet and support recipes - not true native geometry). Import the RVM binary through the evidence pipeline for exact geometry.`,
      }
    : {
        severity: 'info',
        code: 'STAGE_ATT_HIERARCHY_NO_GEOMETRY',
        message: 'Source is an ATT-managed hierarchy export with attributes but no facet/mesh geometry, and no usable position attributes were found to derive a schematic. Hierarchy and attributes are still available; import the RVM binary through the evidence pipeline for 3D geometry.',
      });
  return model;
}

function flattenAttTree(items, rootId) {
  const nodes = [];
  const primitives = [];
  let nodeCounter = 0;
  let primCounter = 0;
  const nextNodeId = () => `node-att-${String(++nodeCounter).padStart(6, '0')}`;
  const nextPrimId = () => `prim-att-${String(++primCounter).padStart(6, '0')}`;
  const walk = (list, parentId, parentPath) => {
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item !== 'object') continue;
      const id = nextNodeId();
      const name = String(item.name || id);
      const path = parentPath ? `${parentPath}/${name}` : name;
      const attrs = plainAttributes(item);
      const primitiveIds = [];
      const nodePrimitives = buildComponentPrimitives(item.type, item.attributes || {}, id, nextPrimId, attrs);
      for (const primitive of nodePrimitives) { primitives.push(primitive); primitiveIds.push(primitive.id); }
      nodes.push({
        id, parentId, name, path,
        kind: String(item.type || 'UNKNOWN'),
        componentIds: [],
        primitiveIds,
        attributes: attrs,
        ...(plainObject(item.enrichedAttributes) ? { enrichedAttributes: clonePlain(item.enrichedAttributes) } : {}),
        diagnostics: diagnosticRows(item),
        sourceId: String(item.id || ''),
      });
      if (Array.isArray(item.children) && item.children.length) walk(item.children, id, path);
    }
  };
  walk(items, rootId, '');
  return { nodes, primitives };
}

// ---- per-component recipe dispatch -------------------------------------------------------------

function buildComponentPrimitives(rawType, rawAttrs, nodeId, nextPrimId, sourceAttrs) {
  const type = String(rawType || 'UNKNOWN').toUpperCase();
  const start = pointFromAttr(rawAttrs.APOS) || pointFromAttr(rawAttrs.POS);
  const end = pointFromAttr(rawAttrs.LPOS);
  const pos = pointFromAttr(rawAttrs.POS) || start || end;
  const arriveRadius = boreRadiusMm(rawAttrs.ABORE) ?? boreRadiusMm(rawAttrs.HBOR) ?? DEFAULT_RADIUS_MM;
  const leaveRadius = boreRadiusMm(rawAttrs.LBORE) ?? boreRadiusMm(rawAttrs.TBOR) ?? arriveRadius;
  const radius = arriveRadius;
  const spanLen = start && end ? distance(start, end) : 0;
  const hasSpan = spanLen > MIN_SEGMENT_LENGTH_MM;
  const emit = (builder) => attachSourceAttributes(builder(nextPrimId, nodeId), sourceAttrs);
  const out = [];

  switch (type) {
    case 'BRANCH':
      // Container node - geometry is carried by its PIPE/fitting children.
      return out;
    case 'PIPE':
      if (hasSpan) out.push(emit((next, n) => cylinderPrimitive(next(), n, start, end, radius)));
      break;
    case 'ELBO':
    case 'ELBOW':
    case 'BEND':
      buildElbowArc(out, emit, start, pos, end, radius);
      break;
    case 'FLAN':
    case 'FLANGE':
      buildFlange(out, emit, start, end, radius, String(rawAttrs.DTXR || ''));
      break;
    case 'REDU':
    case 'REDUCER':
      if (hasSpan) out.push(emit((next, n) => conePrimitive(next(), n, start, end, arriveRadius, leaveRadius, 'reducerCone')));
      break;
    case 'VALV':
    case 'VALVE':
    case 'INST':
      buildValve(out, emit, start, end, pos, radius, type);
      break;
    case 'TEE':
      buildTee(out, emit, start, end, pos, radius);
      break;
    case 'GASK':
    case 'GASKET':
      buildGasket(out, emit, start, end, pos, radius);
      break;
    case 'OLET':
      if (hasSpan) out.push(emit((next, n) => cylinderPrimitive(next(), n, start, end, Math.max(radius * 0.9, DEFAULT_RADIUS_MM * 0.6))));
      break;
    case 'SUPPORT':
      buildSupport(out, emit, rawAttrs, pos, radius);
      break;
    default:
      if (hasSpan) out.push(emit((next, n) => cylinderPrimitive(next(), n, start, end, radius)));
      break;
  }

  if (!out.length) {
    const point = start || end || pos;
    if (point) out.push(emit((next, n) => spherePrimitive(next(), n, point, Math.max(radius * 0.5, 15))));
  }
  return out;
}

function attachSourceAttributes(primitive, sourceAttrs) {
  const attrs = sourceAttrs && typeof sourceAttrs === 'object' && !Array.isArray(sourceAttrs) ? { ...sourceAttrs } : {};
  if (!Object.keys(attrs).length) return primitive;
  return { ...primitive, attributes: { ...attrs }, sourceAttributes: { ...attrs } };
}

// ---- recipe builders ---------------------------------------------------------------------------

function buildElbowArc(out, emit, start, corner, end, radius) {
  if (!start || !end) {
    const point = corner || start || end;
    if (point) out.push(emit((next, n) => spherePrimitive(next(), n, point, radius)));
    return;
  }
  const control = corner || midpoint(start, end);
  const segments = 6;
  let previous = start;
  for (let i = 1; i <= segments; i += 1) {
    const point = quadraticBezier(start, control, end, i / segments);
    if (distance(previous, point) > MIN_SEGMENT_LENGTH_MM) out.push(emit((next, n) => cylinderPrimitive(next(), n, previous, point, radius)));
    previous = point;
  }
}

function buildFlange(out, emit, start, end, radius, dtxr) {
  const faceRadius = flangeRadius(radius);
  if (!start || !end || distance(start, end) <= MIN_SEGMENT_LENGTH_MM) {
    const point = start || end;
    if (point) out.push(emit((next, n) => spherePrimitive(next(), n, point, faceRadius)));
    return;
  }
  if (/BLIND/i.test(dtxr)) {
    out.push(emit((next, n) => conePrimitive(next(), n, start, end, faceRadius, faceRadius, 'blindFlangeDisk')));
    return;
  }
  const split = lerp(start, end, 0.46);
  out.push(emit((next, n) => conePrimitive(next(), n, start, split, radius, hubRadius(radius), 'weldNeckHub')));
  out.push(emit((next, n) => conePrimitive(next(), n, split, end, faceRadius, faceRadius, 'raisedFaceDisk')));
}

function buildValve(out, emit, start, end, pos, radius, type) {
  if (!start || !end || distance(start, end) <= MIN_SEGMENT_LENGTH_MM) {
    const point = pos || start || end;
    if (point) out.push(emit((next, n) => spherePrimitive(next(), n, point, valveRadius(radius))));
    return;
  }
  const faceRadius = flangeRadius(radius);
  const seatRadius = Math.max(radius * 1.04, radius + 2);
  const ballRadius = valveRadius(radius);
  const p = proportionalPoints(start, end, [0.14, 0.16, 0.4, 0.16, 0.14]);
  out.push(emit((next, n) => conePrimitive(next(), n, p[0], p[1], faceRadius, faceRadius, 'leftEndFlange')));
  out.push(emit((next, n) => cylinderPrimitive(next(), n, p[1], p[2], seatRadius, 'leftSeat')));
  out.push(emit((next, n) => spherePrimitive(next(), n, midpoint(p[2], p[3]), ballRadius, 'valveBody')));
  out.push(emit((next, n) => cylinderPrimitive(next(), n, p[3], p[4], seatRadius, 'rightSeat')));
  out.push(emit((next, n) => conePrimitive(next(), n, p[4], p[5], faceRadius, faceRadius, 'rightEndFlange')));
  if (type === 'INST') {
    // A small actuator/instrument box perched above the valve body.
    const centre = midpoint(p[2], p[3]);
    const boxSize = Math.max(radius * 1.6, 60);
    const boxCentre = { x: centre.x, y: centre.y, z: centre.z + ballRadius + boxSize / 2 };
    out.push(emit((next, n) => boxPrimitive(next(), n, boxCentre, [boxSize, boxSize, boxSize], 'actuator')));
  }
}

function buildTee(out, emit, start, end, pos, radius) {
  if (start && end && distance(start, end) > MIN_SEGMENT_LENGTH_MM) {
    out.push(emit((next, n) => cylinderPrimitive(next(), n, start, end, radius)));
    const runAxis = normalize(subtract(end, start));
    const branchDir = perpendicular(runAxis);
    const branchStart = pos || midpoint(start, end);
    const branchLength = Math.max(distance(start, end) * 0.5, radius * 3);
    const branchEnd = addScaled(branchStart, branchDir, branchLength);
    out.push(emit((next, n) => cylinderPrimitive(next(), n, branchStart, branchEnd, Math.max(radius * 0.92, radius - 4))));
    return;
  }
  const point = pos || start || end;
  if (point) out.push(emit((next, n) => spherePrimitive(next(), n, point, radius)));
}

function buildGasket(out, emit, start, end, pos, radius) {
  const diskRadius = Math.max(flangeRadius(radius) * 0.82, radius + 20);
  if (start && end && distance(start, end) > 0.2) {
    out.push(emit((next, n) => conePrimitive(next(), n, start, end, diskRadius, diskRadius, 'gasketDisk')));
    return;
  }
  const centre = pos || start || end;
  if (centre) {
    const thickness = Math.max(radius * 0.08, 4);
    const a = { x: centre.x, y: centre.y - thickness, z: centre.z };
    const b = { x: centre.x, y: centre.y + thickness, z: centre.z };
    out.push(emit((next, n) => conePrimitive(next(), n, a, b, diskRadius, diskRadius, 'gasketDisk')));
  }
}

function buildSupport(out, emit, rawAttrs, pos, radius) {
  const centre = pos || pointFromAttr(rawAttrs.APOS) || pointFromAttr(rawAttrs.LPOS);
  if (!centre) return;
  const width = Math.max(radius * 2.4, 90);
  const height = Math.max(radius * 0.7, 30);
  const shoeCentre = { x: centre.x, y: centre.y, z: centre.z - radius - height / 2 };
  out.push(emit((next, n) => boxPrimitive(next(), n, shoeCentre, [width, width, height], 'supportShoe')));
}

// ---- primitive factories -----------------------------------------------------------------------

function cylinderPrimitive(id, nodeId, start, end, radius, role = 'segment') {
  const safeRadius = Math.max(Number(radius) || DEFAULT_RADIUS_MM, 0.5);
  return basePrimitive(id, nodeId, 'CYLINDER', segmentBbox(start, end, safeRadius), {
    radius: safeRadius,
    startPoint: start,
    endPoint: end,
    role,
  });
}

function conePrimitive(id, nodeId, start, end, radiusBottom, radiusTop, role = 'cone') {
  const rb = Math.max(Number(radiusBottom) || 0, 0.5);
  const rt = Math.max(Number(radiusTop) || 0, 0.5);
  const maxRadius = Math.max(rb, rt);
  const height = distance(start, end);
  return basePrimitive(id, nodeId, 'FLANGE', segmentBbox(start, end, maxRadius), {
    radiusBottom: rb,
    radiusTop: rt,
    height,
    startPoint: start,
    endPoint: end,
    role,
  });
}

function spherePrimitive(id, nodeId, point, radius, role = 'marker') {
  const safeRadius = Math.max(Number(radius) || 0, 0.5);
  const bboxWorld = [point.x - safeRadius, point.y - safeRadius, point.z - safeRadius, point.x + safeRadius, point.y + safeRadius, point.z + safeRadius];
  return basePrimitive(id, nodeId, 'SPHERE', bboxWorld, { radius: safeRadius, center: point, role });
}

function boxPrimitive(id, nodeId, centre, size, role = 'box') {
  const half = size.map((value) => Math.max(Number(value) || 0, 1) / 2);
  const bboxWorld = [centre.x - half[0], centre.y - half[1], centre.z - half[2], centre.x + half[0], centre.y + half[1], centre.z + half[2]];
  return basePrimitive(id, nodeId, 'BOX', bboxWorld, { size, center: centre, role });
}

function basePrimitive(id, nodeId, renderKind, bboxWorld, nativeParams) {
  return {
    id, nodeId,
    native: { code: -1, kind: `att-derived-${String(nativeParams.role || renderKind).toLowerCase()}`, decoded: true },
    geometryDecoded: true,
    nativeParams,
    transform: { matrix3x4: IDENTITY_MATRIX_3X4, bboxWorld },
    renderKind,
    confidence: { geometry: 'derived', semantic: 'attribute' },
    diagnostics: [],
  };
}

// ---- radius conventions (adapted from managed-stage piping recipes) -----------------------------

function flangeRadius(pipeRadius) { return Math.max(pipeRadius * 1.55, pipeRadius + 35); }
function valveRadius(pipeRadius) { return Math.max(pipeRadius * 1.35, pipeRadius + 25); }
function hubRadius(pipeRadius) { return Math.max(pipeRadius * 1.18, pipeRadius + 8); }

// ---- geometry helpers --------------------------------------------------------------------------

function segmentBbox(start, end, radius) {
  return [
    Math.min(start.x, end.x) - radius, Math.min(start.y, end.y) - radius, Math.min(start.z, end.z) - radius,
    Math.max(start.x, end.x) + radius, Math.max(start.y, end.y) + radius, Math.max(start.z, end.z) + radius,
  ];
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function quadraticBezier(a, control, b, t) {
  const u = 1 - t;
  const w0 = u * u;
  const w1 = 2 * u * t;
  const w2 = t * t;
  return {
    x: w0 * a.x + w1 * control.x + w2 * b.x,
    y: w0 * a.y + w1 * control.y + w2 * b.y,
    z: w0 * a.z + w1 * control.z + w2 * b.z,
  };
}

function proportionalPoints(start, end, weights) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  const points = [start];
  let cursor = 0;
  for (const weight of weights) {
    cursor += weight / total;
    points.push(lerp(start, end, cursor));
  }
  points[points.length - 1] = end;
  return points;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function addScaled(point, direction, scale) {
  return { x: point.x + direction.x * scale, y: point.y + direction.y * scale, z: point.z + direction.z * scale };
}

function perpendicular(axis) {
  // Prefer a mostly-vertical branch when the run is horizontal, else fall back to world X.
  const reference = Math.abs(axis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const cross = {
    x: axis.y * reference.z - axis.z * reference.y,
    y: axis.z * reference.x - axis.x * reference.z,
    z: axis.x * reference.y - axis.y * reference.x,
  };
  if (Math.hypot(cross.x, cross.y, cross.z) < 1e-6) return { x: 0, y: 0, z: 1 };
  return normalize(cross);
}

function pointFromAttr(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x), y = Number(value.y), z = Number(value.z);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

function boreRadiusMm(value) {
  if (value === undefined || value === null) return null;
  const match = String(value).match(/[\d.]+/);
  if (!match) return null;
  const bore = Number.parseFloat(match[0]);
  return Number.isFinite(bore) && bore > 0 ? bore / 2 : null;
}

function plainAttributes(item) {
  const out = {};
  if (item.bore !== undefined) out.bore = item.bore;
  if (item.attributes && typeof item.attributes === 'object') {
    for (const [key, value] of Object.entries(item.attributes)) {
      out[key] = value && typeof value === 'object' ? JSON.stringify(value) : value;
    }
  }
  return out;
}

function diagnosticRows(item) {
  const rows = [
    ...(Array.isArray(item?.diagnostics) ? item.diagnostics : []),
    ...(Array.isArray(item?.enrichedAttributes?.diagnostics) ? item.enrichedAttributes.diagnostics : []),
  ];
  return [...new Map(rows.map((row) => [row?.id || JSON.stringify(row), clonePlain(row)])).values()];
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
