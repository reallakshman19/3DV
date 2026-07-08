/**
 * Builds converter-ready JSON from the 3D JSON Viewer state.
 * Parameters: an RvmStageModel, source file name, and selected viewer refs.
 * Outputs: rvm-converter-stage/v1 JSON with selected items plus derived RVM
 * attachment support candidates. Fallback: when no branch selection can be
 * inferred, no support candidates are emitted and diagnostics explain the gap.
 */

import { directionForSupportKind, supportKindFromText } from './RvmConverterJsonSideload.js';

function text(value) { return String(value ?? '').trim(); }
function cleanPath(value) { return text(value).replace(/\s+\/+/g, '/').replace(/\s+/g, ' ').replace(/\/$/, ''); }
function refKey(ref) { return `${text(ref?.type)}:${text(ref?.id)}`; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function firstAttr(attrs, keys) {
  for (const key of keys) if (text(attrs?.[key])) return text(attrs[key]);
  return '';
}
function bboxCenter(box) {
  return Array.isArray(box) && box.length >= 6
    ? { x: (Number(box[0]) + Number(box[3])) / 2, y: (Number(box[1]) + Number(box[4])) / 2, z: (Number(box[2]) + Number(box[5])) / 2 }
    : null;
}
function primitivePath(primitive) {
  return cleanPath(primitive?.source?.parentPath || primitive?.parentPath || primitive?.semantic?.parentPath || primitive?.semantic?.linePath);
}
function branchBase(path) {
  const parts = cleanPath(path).split('/').filter(Boolean);
  const exact = parts.findIndex((part) => /^B\d+$/i.test(part));
  if (exact >= 0) return `/${parts.slice(0, exact + 1).join('/')}`;
  const loose = parts.findIndex((part) => /^B\d+/i.test(part));
  return loose >= 0 ? `/${parts.slice(0, loose + 1).join('/')}` : '';
}
function psNoFromPath(path) {
  return cleanPath(path).match(/\bPS-\d+(?:\.\d+)?\b/i)?.[0] || '';
}
function lineNoFromPath(path) {
  const parts = cleanPath(path).split('/').filter(Boolean);
  return parts.find((part) => /\d+"\-[A-Z0-9]/i.test(part)) || '';
}
function lineNoFromAttrs(attrs, path) {
  return firstAttr(attrs, ['LINE_NO', 'LINENO', 'LINE', 'BRANCHNAME', 'BRANCH_NAME']) || lineNoFromPath(path);
}
function psNoFromAttrs(attrs, path) {
  return firstAttr(attrs, ['SUPPORT_TAG', 'PSNO', 'PS_NO', 'NAME', 'CMPSUPREFN', 'CMPSTRESSN', 'MDSGUIDEREF']) || psNoFromPath(path);
}
function candidateAttrs(attrs) {
  const source = attrs || {};
  return {
    SUPPORT_TAG: firstAttr(source, ['SUPPORT_TAG', 'PSNO', 'PS_NO', 'NAME', 'CMPSUPREFN', 'CMPSTRESSN', 'MDSGUIDEREF']),
    LINE_NO: firstAttr(source, ['LINE_NO', 'LINENO', 'LINE']),
    DTXR: firstAttr(source, ['DTXR']),
    CMPSUPGAP: firstAttr(source, ['CMPSUPGAP', 'NODEGAP', 'GAP']),
    CMPSUPTYPE: firstAttr(source, ['CMPSUPTYPE']),
    SUPPORT_KIND: firstAttr(source, ['SUPPORT_KIND', 'SUPPORT_MAPPER_KIND']),
    SUPPORT_TYPE: firstAttr(source, ['SUPPORT_TYPE']),
    MDSSUPPTYPE: firstAttr(source, ['MDSSUPPTYPE']),
  };
}
function attachmentOwnerPath(path) {
  const marker = cleanPath(path).toUpperCase().indexOf('/ATTACHMENT ');
  return marker >= 0 ? cleanPath(path).slice(0, marker) : '';
}
function attachmentGroupPath(path) {
  const cleaned = cleanPath(path);
  const marker = cleaned.toUpperCase().indexOf('/ATTACHMENT ');
  if (marker < 0) return '';
  const owner = cleaned.slice(0, marker);
  const group = cleaned.slice(marker).match(/^\/ATTACHMENT\s+\d+\s+of\s+BRANCH/i)?.[0] || '';
  return group ? cleanPath(`${owner}${group}`) : '';
}
function itemForRef(model, ref) {
  if (!model || !ref) return null;
  if (ref.type === 'root') return { id: ref.id, schema: model.schema, source: model.source };
  if (ref.type === 'node') return model.hierarchy?.nodes?.find((item) => item.id === ref.id) || null;
  if (ref.type === 'component') return model.components?.find((item) => item.id === ref.id) || null;
  if (ref.type === 'primitive') return model.primitives?.find((item) => item.id === ref.id) || null;
  return null;
}
function nodeById(model) {
  return new Map((model?.hierarchy?.nodes || []).map((node) => [node.id, node]));
}
function primitiveIdsForRef(model, ref) {
  if (!model || !ref) return [];
  if (ref.type === 'root') return (model.primitives || []).map((primitive) => primitive.id);
  if (ref.type === 'primitive') return [ref.id];
  if (ref.type === 'component') return itemForRef(model, ref)?.primitiveIds || [];
  if (ref.type === 'node') {
    const node = itemForRef(model, ref);
    const direct = node?.primitiveIds || [];
    const componentIds = new Set(node?.componentIds || []);
    const componentPrimitives = (model.components || []).filter((item) => componentIds.has(item.id)).flatMap((item) => item.primitiveIds || []);
    return [...direct, ...componentPrimitives];
  }
  return [];
}
function selectedPrimitiveSet(model, refs) {
  return new Set(unique((refs || []).flatMap((ref) => primitiveIdsForRef(model, ref))));
}
function supportPosition(primitive) {
  return primitive?.nativeParams?.center || primitive?.geometry?.nativeParams?.center || bboxCenter(primitive?.transform?.bboxWorld || primitive?.bboxWorld || primitive?.nativeGeometry?.bboxWorld);
}
function supportCandidate(primitive, index, selectedIds) {
  const path = primitivePath(primitive);
  const ownerPath = attachmentOwnerPath(path);
  const position = supportPosition(primitive);
  if (!ownerPath || !position) return null;
  const lineNo = lineNoFromPath(ownerPath);
  const psNo = psNoFromPath(path);
  return {
    id: `rvm-support-${String(index + 1).padStart(5, '0')}`,
    sourceRef: primitive.id || '',
    primitiveId: primitive.id || '',
    ownerBranchPath: branchBase(ownerPath) || ownerPath,
    attachmentPath: attachmentGroupPath(path),
    branchName: branchBase(ownerPath) || ownerPath,
    psNo,
    lineNo,
    restraintType: 'REST',
    direction: '+Y',
    position,
    nativeKind: primitive.native?.kind || primitive.nativeKind || primitive.renderKind || '',
    nativeCode: primitive.nativeCode ?? primitive.native?.code ?? null,
    renderKind: primitive.renderKind || '',
    selected: selectedIds.has(primitive.id),
    method: 'rvm-attachment-hierarchy',
    confidence: 'derived-from-rvm-container-path',
  };
}
function selectedBranchBases(model, refs) {
  const ids = selectedPrimitiveSet(model, refs);
  const byId = new Map((model?.primitives || []).map((primitive) => [primitive.id, primitive]));
  return new Set([...ids].map((id) => branchBase(attachmentOwnerPath(primitivePath(byId.get(id))) || primitivePath(byId.get(id)))).filter(Boolean));
}
function supportCandidatesForSelection(model, refs) {
  const ids = selectedPrimitiveSet(model, refs);
  const bases = selectedBranchBases(model, refs);
  const includeAll = (refs || []).some((ref) => ref.type === 'root');
  if (!bases.size && !includeAll) return [];
  return (model?.primitives || [])
    .filter((primitive) => includeAll || bases.has(branchBase(attachmentOwnerPath(primitivePath(primitive)))))
    .map((primitive, index) => supportCandidate(primitive, index, ids))
    .filter(Boolean);
}
function isAttSupportPrimitive(primitive) {
  const label = [primitive?.native?.kind, primitive?.nativeKind, primitive?.renderKind, primitive?.nativeParams?.role].map(text).join(' ').toLowerCase();
  return label.includes('supportshoe') || label.includes('support');
}
function attSupportCandidate(model, primitive, index, selectedIds, nodes) {
  if (!isAttSupportPrimitive(primitive)) return null;
  const node = nodes.get(primitive.nodeId) || {};
  const attrs = node.attributes || {};
  const path = cleanPath(node.path || node.name || primitive.nodeId);
  const position = supportPosition(primitive);
  if (!position) return null;
  const mapped = candidateAttrs(attrs);
  const kind = supportKindFromText(mapped.SUPPORT_KIND, mapped.SUPPORT_TYPE, mapped.CMPSUPTYPE, mapped.MDSSUPPTYPE, mapped.DTXR);
  const restraintType = kind || 'REST';
  const psNo = psNoFromAttrs(attrs, path);
  const lineNo = lineNoFromAttrs(attrs, path);
  return {
    id: `att-support-${String(index + 1).padStart(5, '0')}`,
    sourceRef: primitive.id || '',
    primitiveId: primitive.id || '',
    nodeId: primitive.nodeId || '',
    ownerBranchPath: path,
    attachmentPath: '',
    branchName: branchBase(path) || path || '/ATT/SUPPORTS',
    psNo,
    lineNo,
    boreMm: firstAttr(attrs, ['ABORE', 'LBORE', 'BORE', 'bore']),
    dtxr: mapped.DTXR,
    cmpSupGap: mapped.CMPSUPGAP,
    cmpSupType: mapped.CMPSUPTYPE,
    supportKind: kind,
    supportType: mapped.SUPPORT_TYPE,
    mdsSuppType: mapped.MDSSUPPTYPE,
    restraintType,
    direction: directionForSupportKind(restraintType),
    position,
    sourceAttrs: { ...attrs, ...mapped },
    nativeKind: primitive.native?.kind || primitive.nativeKind || primitive.renderKind || '',
    nativeCode: primitive.nativeCode ?? primitive.native?.code ?? null,
    renderKind: primitive.renderKind || '',
    selected: selectedIds.has(primitive.id),
    method: 'att-managed-support-primitive',
    confidence: kind ? 'derived-from-att-support-attributes' : 'derived-from-att-support-primitive',
  };
}
function attSupportCandidatesForSelection(model, refs) {
  if (model?.source?.kind !== 'att-managed-hierarchy') return [];
  const ids = selectedPrimitiveSet(model, refs);
  if (!ids.size) return [];
  const nodes = nodeById(model);
  return [...ids]
    .map((id) => (model.primitives || []).find((primitive) => primitive.id === id))
    .filter(Boolean)
    .map((primitive, index) => attSupportCandidate(model, primitive, index, ids, nodes))
    .filter(Boolean);
}
function allSupportCandidatesForSelection(model, refs) {
  return [...supportCandidatesForSelection(model, refs), ...attSupportCandidatesForSelection(model, refs)];
}
function branchRowsForCandidates(candidates) {
  const grouped = new Map();
  for (const candidate of candidates) grouped.set(candidate.branchName, (grouped.get(candidate.branchName) || 0) + 1);
  return [...grouped.entries()].map(([branchName, supportCandidateCount]) => ({ branchName, supportCandidateCount }));
}

export function buildRvmConverterJsonPayload({ model, sourceFileName, selectedRefs }) {
  const refs = selectedRefs || [];
  const uniqueRefs = unique(refs.map(refKey)).map((key) => {
    const [type, id] = key.split(':');
    return { type, id };
  });
  const supportCandidates = allSupportCandidatesForSelection(model, uniqueRefs);
  const warnings = [];
  if (model?.source?.kind === 'rvm-binary' && !supportCandidates.length) warnings.push('No RVM attachment support candidates matched the current selection branch paths.');
  if (model?.source?.kind === 'rvm-binary') warnings.push('RVM attachment support candidates default to REST/+Y unless the Conv JSON side-load popup supplies support mapping rows.');
  return {
    schema: 'rvm-converter-stage/v1',
    source: { fileName: sourceFileName || '', stageSchema: model?.schema || '', stageSource: model?.source || null },
    selection: { count: uniqueRefs.length, refs: uniqueRefs, items: uniqueRefs.map((ref) => ({ ref, item: itemForRef(model, ref) })) },
    rvmAttContext: {
      status: supportCandidates.length ? 'derived-from-rvm-stage-model' : 'no-rvm-support-candidates',
      branches: branchRowsForCandidates(supportCandidates),
      attributes: [],
      supportCandidates,
    },
    diagnostics: {
      warnings,
      stats: { hierarchyNodes: model?.hierarchy?.nodes?.length || 0, components: model?.components?.length || 0, primitives: model?.primitives?.length || 0, selectedRefs: uniqueRefs.length, supportCandidates: supportCandidates.length },
    },
  };
}
