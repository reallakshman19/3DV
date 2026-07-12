/**
 * Functionality: builds Sel-E and Sel-N JSON contracts from a staged model.
 * Parameters: model, source name, selected references, and explicit mode.
 * Outputs: immutable selection payload with inherited enrichment, diagnostics,
 * source attributes, hierarchy path, and native endpoint data. Fallback:
 * unresolved references emit a null item and are never fabricated.
 */

export const JSON_VIEWER_SELECTION_SCHEMA = 'json-viewer-selection/v1';

export function buildJsonViewerSelectionPayload(model, source, refs, mode) {
  const selectionMode = mode === 'node' ? 'node' : 'element';
  const selected = selectionMode === 'node'
    ? nodeSelectionRows(model, refs)
    : refs.map((ref) => ({ ref: clone(ref), item: itemForRef(model, ref) }));
  return {
    schema: JSON_VIEWER_SELECTION_SCHEMA,
    source: String(source || ''),
    mode: selectionMode,
    selectionMode,
    selected,
  };
}

export function itemForJsonViewerRef(model, ref) {
  return itemForRef(model, ref);
}

function itemForRef(model, ref) {
  if (!model || !ref) return null;
  if (ref.type === 'root') return { id: ref.id, schema: model.schema, source: clone(model.source) };
  if (ref.type === 'node') return nodeForRef(model, ref);
  if (ref.type === 'component') return clone(model.components?.find((item) => item.id === ref.id) || null);
  if (ref.type === 'primitive') return primitiveForRef(model, ref);
  return null;
}

function nodeForRef(model, ref) {
  const node = model.hierarchy?.nodes?.find((item) => item.id === ref.id);
  if (!node) return null;
  return {
    ...clone(node),
    source: { ...(node.source || {}), parentPath: node.path || '', nodeName: node.name || '', nodeKind: node.kind || '' },
    sourceAttributes: clone(node.attributes || {}),
  };
}

function primitiveForRef(model, ref) {
  const primitive = model.primitives?.find((item) => item.id === ref.id);
  if (!primitive) return null;
  const node = model.hierarchy?.nodes?.find((item) => item.id === primitive.nodeId);
  if (!node) return clone(primitive);
  const enrichedAttributes = primitive.enrichedAttributes || node.enrichedAttributes;
  return {
    ...clone(primitive),
    source: { ...(primitive.source || {}), parentPath: node.path || '', nodeName: node.name || '', nodeKind: node.kind || '' },
    semantic: { ...(primitive.semantic || {}), parentPath: node.path || '' },
    attributes: { ...(node.attributes || {}), ...(primitive.attributes || {}) },
    sourceAttributes: { ...(node.attributes || {}), ...(primitive.sourceAttributes || {}) },
    diagnostics: [...clone(node.diagnostics || []), ...clone(primitive.diagnostics || [])],
    ...(enrichedAttributes ? { enrichedAttributes: clone(enrichedAttributes) } : {}),
  };
}

function nodeSelectionRows(model, refs) {
  const rows = new Map();
  for (const ref of refs) {
    const nodeRef = nodeRefForSelection(model, ref);
    if (!nodeRef || rows.has(nodeRef.id)) continue;
    const node = nodeForRef(model, nodeRef);
    const nodeIds = descendantNodeIds(model, nodeRef.id);
    const primitives = (model.primitives || []).filter((item) => nodeIds.has(item.nodeId)).map((item) => primitiveForRef(model, { type: 'primitive', id: item.id })).filter(Boolean);
    rows.set(nodeRef.id, { ref: nodeRef, item: node ? { ...node, selectionMode: 'node', primitives } : null });
  }
  return [...rows.values()];
}

function descendantNodeIds(model, rootId) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of model?.hierarchy?.nodes || []) {
      if (ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); changed = true; }
    }
  }
  return ids;
}

function nodeRefForSelection(model, ref) {
  if (ref?.type === 'node') return { type: 'node', id: ref.id };
  if (ref?.type !== 'primitive') return null;
  const primitive = model?.primitives?.find((item) => item.id === ref.id);
  return primitive?.nodeId ? { type: 'node', id: primitive.nodeId } : null;
}

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}
