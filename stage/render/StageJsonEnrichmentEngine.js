/**
 * Functionality: populates calculation-ready piping attributes onto Stage JSON
 * viewer hierarchy nodes by running the XML->CII(2019) branch resolvers
 * headlessly (no converter UI involved). Parameters: loaded StageModel and the
 * viewer enrichment state (regex config + imported line list / piping class /
 * material map / weight master rows). Outputs: Map of nodeId -> enriched
 * attribute record (wall thickness, corrosion, rating, P1/T1, fluid density &
 * phase, insulation thickness, component & pipe weights). Fallback: nodes
 * without a resolvable branch produce a record flagged needsReview/missing.
 */

import { buildSelectedGeometryWorkflowConfig } from '../../enrichment/selected-geometry-branch-workflow.js';
import { deriveLineKeyFromBranchName } from '../../converters/xml-cii2019-core/regex-line-key.js';
import { buildPipingClassIndex } from '../../converters/xml-cii2019-core/piping-class-resolver.js';
import { resolveBranchProcessData } from '../../converters/xml-cii2019-core/branch-process-resolver.js';
import { resolveLineListDensity } from '../../converters/xml-cii2019-core/line-density-resolver.js';
import { rankXmlCiiWeightCandidates } from '../../converters/xml-cii2019-core/weight-valve-hints.js';
import {
  deriveBoreFromBranchName,
  derivePipingClassFromBranchName,
  deriveRatingFromPipingClass,
  findLineListRow,
} from '../../enrichment/selected-geometry-branch-helpers.js';
import { rowNumber, rowValue } from '../../enrichment/selected-geometry-shared.js';

export const STAGE_JSON_ENRICHED_ATTRIBUTES_SCHEMA = 'stage-json-enriched-attributes/v2';

// Managed-stage component kinds that participate in enrichment. BRANCH nodes
// carry the routable branch name; component nodes inherit from their branch.
const COMPONENT_KINDS = new Set([
  'PIPE', 'ELBO', 'ELBOW', 'BEND', 'TEE', 'REDU', 'REDUCER', 'FLAN', 'FLANGE',
  'VALV', 'VALVE', 'INST', 'GASK', 'GASKET', 'OLET', 'SUPPORT', 'ATTA', 'BRANCH',
]);

const WEIGHTED_COMPONENT_KINDS = new Set(['FLAN', 'FLANGE', 'VALV', 'VALVE', 'INST', 'TEE', 'REDU', 'REDUCER', 'ELBO', 'ELBOW', 'BEND', 'GASK', 'GASKET', 'OLET']);

// ASME B36.10/19 nominal DN (mm) -> outside diameter (mm).
const DN_TO_OD_MM = Object.freeze(new Map([
  [6, 10.3], [8, 13.7], [10, 17.1], [15, 21.3], [20, 26.7], [25, 33.4],
  [32, 42.2], [40, 48.3], [50, 60.3], [65, 73.0], [80, 88.9], [100, 114.3],
  [125, 141.3], [150, 168.3], [200, 219.1], [250, 273.0], [300, 323.9],
  [350, 355.6], [400, 406.4], [450, 457.0], [500, 508.0], [600, 610.0],
]));

const STEEL_DENSITY_KG_M3 = 7850;

export function runJsonViewerEnrichment(model, enrichmentState) {
  const config = buildEngineConfig(enrichmentState);
  const pipingClassIndex = buildPipingClassIndex(config.pipingClass?.masterRows || []);
  const nodes = Array.isArray(model?.hierarchy?.nodes) ? model.hierarchy.nodes : [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const branchCache = new Map(); // branchName -> resolved branch-level record

  const enrichedAttributes = new Map(); // nodeId -> EnrichedPipingAttributes

  for (const node of nodes) {
    const kind = String(node?.kind || '').toUpperCase();
    if (!COMPONENT_KINDS.has(kind)) continue;
    const branchName = branchNameForNode(node, nodesById);
    if (!branchName) continue;
    const branch = resolveBranchRecord(branchName, branchCache, config, pipingClassIndex);
    enrichedAttributes.set(node.id, buildNodeRecord(node, kind, branch, config));
  }

  // Legacy RVM-model path: components carry nodeIds already covered above; any
  // component whose node was not walked (no hierarchy entry) is enriched from
  // its own name so RVM stage models keep working.
  for (const comp of model?.components || []) {
    if (!comp?.nodeId || enrichedAttributes.has(comp.nodeId)) continue;
    const branchName = String(comp.name || comp.nodeId);
    const branch = resolveBranchRecord(branchName, branchCache, config, pipingClassIndex);
    enrichedAttributes.set(comp.nodeId, buildNodeRecord({ id: comp.nodeId, name: branchName, attributes: {} }, 'PIPE', branch, config));
  }

  return enrichedAttributes;
}

function buildEngineConfig(state) {
  const rawConfig = {
    linelist: {
      tokenDelimiter: state.delimiter || '-',
      lineKeyTokenPositions: String(state.lineKeyPosition || 4),
    },
    rating: {
      tokenDelimiter: state.delimiter || '-',
      pipingClassTokenIndex: String(state.pipingClassPosition || 5),
    },
    weight: {
      tokenDelimiter: state.delimiter || '-',
      boreTokenIndex: String(state.sizePosition || 3),
    },
  };
  return buildSelectedGeometryWorkflowConfig({
    masters: {
      lineList: state.masters?.lineList || [],
      pipingClass: state.masters?.pipingClass || [],
      materialMap: state.masters?.materialMap || [],
      weightMaster: state.masters?.weightMaster || [],
    },
    config: rawConfig,
  });
}

// Walk ancestors to the owning BRANCH node; fall back to OWNER attribute, then
// to the node's own name (RVM-style nodes are often the branch themselves).
function branchNameForNode(node, nodesById) {
  let cursor = node;
  let hops = 0;
  while (cursor && hops < 64) {
    if (String(cursor.kind || '').toUpperCase() === 'BRANCH') return String(cursor.name || '');
    cursor = nodesById.get(cursor.parentId);
    hops += 1;
  }
  const owner = node?.attributes?.OWNER || node?.attributes?.OWNER_NAME;
  if (owner) return String(owner);
  return String(node?.name || node?.path || '');
}

function resolveBranchRecord(branchName, branchCache, config, pipingClassIndex) {
  if (branchCache.has(branchName)) return branchCache.get(branchName);

  const lineKey = deriveLineKeyFromBranchName(branchName, config) || '';
  const lineRow = lineKey ? findLineListRow(lineKey, config) : null;
  const pipingClassFromBranch = derivePipingClassFromBranchName(branchName, config)
    || rowValue(lineRow, ['pipingClass', 'Piping Class', 'PIPING_CLASS']);
  let boreMm = deriveBoreFromBranchName(branchName, config);
  if (boreMm == null && lineRow) boreMm = rowNumber(lineRow, ['convertedBore', 'bore', 'DN', 'NB', 'NPS']);

  const ratingSeed = deriveRatingFromPipingClass(pipingClassFromBranch, config)
    || rowValue(lineRow, ['rating', 'Rating', 'RATING']);

  const resolved = resolveBranchProcessData({
    branchName,
    lineKey,
    lineRow: { ...(lineRow || {}), pipingClass: pipingClassFromBranch },
    boreMm,
    componentType: 'PIPE',
    rating: ratingSeed,
    materialMap: config.material?.mapRows || [],
    pipingClassIndex,
    overrides: config.overrides || {},
    xmlNode: null,
    xmlBranch: null,
    config,
  });

  const rating = ratingSeed || resolved.rating || '';
  const densityInfo = resolveLineListDensity(lineRow, null);
  const schedule = rowValue(resolved.pipingClassMatchedRow, ['schedule', 'Schedule', 'SCHEDULE', 'SCH', 'Sch']);
  const pipeOdMm = firstFinite(
    rowNumber(resolved.pipingClassMatchedRow, ['od', 'OD', 'OD_MM', 'Outside Diameter', 'PIPE_OD']),
    boreMm != null ? DN_TO_OD_MM.get(Math.round(boreMm)) ?? null : null,
  );
  // The core resolver defaults wall thickness to 0 when nothing matched; keep
  // it null here so calculations flag it missing instead of computing 0 weight.
  let wallThicknessMm = toFinite(resolved.wallThicknessMm);
  if (wallThicknessMm === 0 && !resolved.pipingClassMatchedRow) wallThicknessMm = null;
  const insideDiameterMm = pipeOdMm != null && wallThicknessMm != null ? round3(pipeOdMm - 2 * wallThicknessMm) : null;
  const pipeWeightKgPerM = pipeOdMm != null && insideDiameterMm != null
    ? round3((Math.PI / 4) * (pipeOdMm ** 2 - insideDiameterMm ** 2) * 1e-6 * STEEL_DENSITY_KG_M3)
    : null;

  const record = {
    branchName,
    lineKey,
    lineRow,
    lineMiss: !lineRow,
    pipingClass: resolved.pipingClass || pipingClassFromBranch || '',
    rating,
    p1: rowValue(lineRow, ['p1']),
    t1: rowValue(lineRow, ['t1']),
    t2: rowValue(lineRow, ['t2']),
    t3: rowValue(lineRow, ['t3']),
    hydroPressure: rowValue(lineRow, ['hydroPressure']),
    fluidPhase: String(densityInfo.phase || rowValue(lineRow, ['phase']) || ''),
    fluidDensityKgM3: toFinite(densityInfo.value),
    fluidDensitySource: densityInfo.source || 'none',
    fluidService: rowValue(lineRow, ['lineKey1', 'Service', 'Fluid', 'SERVICE', 'FLUID']),
    insulationThicknessMm: toFinite(rowValue(lineRow, ['insThk'])),
    nominalBoreMm: boreMm ?? null,
    pipeOdMm: pipeOdMm ?? null,
    schedule,
    wallThicknessMm,
    wallThicknessSource: resolved.wallThicknessSource || 'none',
    corrosionAllowanceMm: toFinite(resolved.corrosionAllowanceMm),
    corrosionSource: resolved.corrosionSource || 'none',
    material: resolved.material || '',
    materialCode: resolved.materialCode || '',
    materialSource: resolved.materialSource || '',
    pipeWeightKgPerM,
    pipingClassConfidence: resolved.pipingClassConfidence ?? null,
    pipingClassNeedsReview: Boolean(resolved.pipingClassNeedsReview),
  };
  branchCache.set(branchName, record);
  return record;
}

function buildNodeRecord(node, kind, branch, config) {
  const attrs = node?.attributes || {};
  const nodeBoreMm = boreMmFromAttr(attrs.ABORE) ?? boreMmFromAttr(attrs.HBOR) ?? boreMmFromAttr(attrs.bore) ?? branch.nominalBoreMm;
  const nodeOdMm = nodeBoreMm != null && nodeBoreMm === branch.nominalBoreMm
    ? branch.pipeOdMm
    : (nodeBoreMm != null ? DN_TO_OD_MM.get(Math.round(nodeBoreMm)) ?? null : null);
  const componentWeight = componentWeightForNode(node, kind, nodeBoreMm, branch, config);

  const missing = [];
  if (!branch.lineKey) missing.push('lineKey');
  if (branch.lineMiss) missing.push('lineListRow');
  if (branch.wallThicknessMm == null) missing.push('wallThicknessMm');
  if (branch.fluidDensityKgM3 == null) missing.push('fluidDensityKgM3');

  return {
    schema: STAGE_JSON_ENRICHED_ATTRIBUTES_SCHEMA,
    // Identity
    branchName: branch.branchName,
    lineNo: branch.lineKey,
    componentType: kind,
    // Piping specification
    pipingClass: branch.pipingClass,
    pressureRating: branch.rating,
    nominalBoreMm: nodeBoreMm,
    pipeOdMm: nodeOdMm ?? branch.pipeOdMm,
    schedule: branch.schedule,
    wallThicknessMm: branch.wallThicknessMm,
    corrosionAllowanceMm: branch.corrosionAllowanceMm,
    // Process conditions
    designPressure: branch.p1 || null,
    designPressureMpa: toFinite(branch.p1),
    designTemperatureC: toFinite(branch.t1),
    operatingTemperatureC: toFinite(branch.t2),
    minimumTemperatureC: toFinite(branch.t3),
    hydroPressure: branch.hydroPressure || null,
    // Fluid
    fluidService: branch.fluidService || null,
    fluidPhase: branch.fluidPhase || null,
    fluidDensityKgM3: branch.fluidDensityKgM3,
    fluidDensitySource: branch.fluidDensitySource,
    // Insulation
    insulationThicknessMm: branch.insulationThicknessMm,
    // Material
    material: branch.material,
    materialCode: branch.materialCode,
    // Weights
    componentWeightKg: componentWeight.weightKg,
    componentWeightMethod: componentWeight.method,
    pipeWeightKgPerM: branch.pipeWeightKgPerM,
    // Audit
    enrichmentConfidence: branch.lineMiss ? 'missing' : (branch.pipingClassNeedsReview ? 'review' : 'resolved'),
    needsReview: branch.lineMiss || branch.pipingClassNeedsReview,
    conflicts: [],
    missing,
    sources: {
      wallThickness: branch.wallThicknessSource,
      corrosion: branch.corrosionSource,
      material: branch.materialSource,
      fluidDensity: branch.fluidDensitySource,
    },
  };
}

// Flange/valve/fitting lump weight from the imported weight master, matched on
// bore + rating + component length (APOS->LPOS) exactly like the XML->CII flow.
function componentWeightForNode(node, kind, boreMm, branch, config) {
  if (!WEIGHTED_COMPONENT_KINDS.has(kind)) return { weightKg: null, method: '' };
  if (!Array.isArray(config.weight?.masterRows) || !config.weight.masterRows.length) return { weightKg: null, method: '' };
  if (boreMm == null || !branch.rating) return { weightKg: null, method: '' };
  const attrs = node?.attributes || {};
  const start = pointFromAttrValue(attrs.APOS) || pointFromAttrValue(attrs.POS);
  const end = pointFromAttrValue(attrs.LPOS);
  const lengthMm = start && end ? Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) : null;
  if (lengthMm == null) return { weightKg: null, method: '' };
  try {
    const ranking = rankXmlCiiWeightCandidates({
      boreMm,
      rating: branch.rating,
      lengthMm,
      nodeName: String(node?.name || node?.id || ''),
      componentType: kind,
      componentRefNo: String(attrs.COMPONENT_REF_NO || attrs.COMPONENTREFNO || ''),
      dtxr: String(attrs.DTXR || attrs.RAW_TYPE || kind),
    }, config, { includeRejected: false });
    const best = ranking?.best || null;
    const weight = toFinite(best?.selectedWeight ?? best?.suggestedWeight ?? best?.weight);
    if (weight == null) return { weightKg: null, method: '' };
    return { weightKg: weight, method: best.weightMethod || 'weight-master' };
  } catch {
    return { weightKg: null, method: '' };
  }
}

function pointFromAttrValue(value) {
  if (!value) return null;
  let source = value;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed.startsWith('{')) return null;
    try { source = JSON.parse(trimmed); } catch { return null; }
  }
  if (!source || typeof source !== 'object') return null;
  const x = Number(source.x), y = Number(source.y), z = Number(source.z);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

function boreMmFromAttr(value) {
  if (value === undefined || value === null || value === '') return null;
  const match = String(value).match(/[\d.]+/);
  if (!match) return null;
  const bore = Number.parseFloat(match[0]);
  return Number.isFinite(bore) && bore > 0 ? bore : null;
}

function toFinite(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function round3(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

export function summarizeEnrichmentCoverage(enrichedMap) {
  let full = 0;
  let partial = 0;
  let missing = 0;
  let conflicts = 0;

  for (const attrs of enrichedMap.values()) {
    if (attrs.conflicts && attrs.conflicts.length > 0) {
      conflicts++;
    } else if (attrs.enrichmentConfidence === 'missing' || !attrs.lineNo) {
      missing++;
    } else if (attrs.needsReview) {
      partial++;
    } else {
      full++;
    }
  }
  return { full, partial, missing, conflicts, total: enrichedMap.size };
}
