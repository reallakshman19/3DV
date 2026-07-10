/**
 * Functionality: renders selected StageModel properties as grouped tables.
 * Parameters: target element, StageModel, and the active selection ref.
 * Outputs: readable identity, geometry, confidence, render, and attribute rows.
 * Fallback: missing selections render an empty state instead of raw JSON.
 */

function findItem(model, selectedRef) {
  if (!model || !selectedRef) return null;
  if (selectedRef.type === 'root') return rootItem(model, selectedRef.id);
  if (selectedRef.type === 'node') return model.hierarchy?.nodes?.find((node) => node.id === selectedRef.id) || null;
  if (selectedRef.type === 'component') return model.components?.find((component) => component.id === selectedRef.id) || null;
  if (selectedRef.type === 'primitive') return model.primitives?.find((primitive) => primitive.id === selectedRef.id) || null;
  return null;
}

function rootItem(model, id) {
  return {
    type: 'root', id, schema: model.schema, fileName: model.source?.fileName,
    fileHash: model.source?.fileHash, units: model.source?.units,
    nodeCount: model.hierarchy?.nodes?.length || 0, componentCount: model.components?.length || 0,
    primitiveCount: model.primitives?.length || 0,
  };
}

function count(value) { return Array.isArray(value) ? value.length : 0; }

function displayValue(value) {
  if (Array.isArray(value)) return value.length > 6 ? `${value.length} items` : value.join(', ');
  if (value && typeof value === 'object') return objectSummary(value);
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function groupsFor(item, selectedRef) {
  if (selectedRef?.type === 'root') return [
    { title: 'Model', rows: [['schema', item.schema], ['source fileName', item.fileName], ['source fileHash', item.fileHash], ['units', item.units]] },
    { title: 'Counts', rows: [['node count', item.nodeCount], ['component count', item.componentCount], ['primitive count', item.primitiveCount]] },
  ];
  if (selectedRef?.type === 'node') return [
    { title: 'Identity', rows: [['id', item.id], ['name', item.name], ['path', item.path], ['kind', item.kind]] },
    { title: 'Geometry', rows: [['component count', count(item.componentIds)], ['primitive count', count(item.primitiveIds)], ['bboxWorld', bboxText(item.bboxWorld)]] },
    { title: 'Attributes', rows: objectRows(item.attributes) },
  ];
  if (selectedRef?.type === 'component') return [
    { title: 'Identity', rows: [['id', item.id], ['name', item.name], ['semanticType', item.semanticType]] },
    { title: 'Confidence', rows: [['confidence.geometry', item.confidence?.geometry], ['confidence.semantic', item.confidence?.semantic]] },
    { title: 'Geometry', rows: [['primitive count', count(item.primitiveIds)], ['bboxWorld', bboxText(item.bboxWorld)]] },
    { title: 'Render', rows: [['renderPolicy', item.renderPolicy]] },
  ];
  if (selectedRef?.type === 'primitive') return [
    { title: 'Identity', rows: [['id', item.id], ['kind', item.kind], ['componentId', item.componentId], ['nodeId', item.nodeId]] },
    { title: 'Geometry', rows: [['bboxWorld', bboxText(item.transform?.bboxWorld)], ['nativeCode', item.source?.nativeCode], ['quality', item.quality]] },
    { title: 'Attributes', rows: attributeRows(item) },
    { title: 'Source', rows: objectRows(item.source) },
  ];
  return [{ title: 'Properties', rows: Object.entries(item || {}) }];
}

export function renderProperties(target, model, selectedRef) {
  target.replaceChildren();
  const item = findItem(model, selectedRef);
  if (!item) {
    const empty = document.createElement('div');
    empty.className = 'json-viewer-empty-state';
    empty.textContent = 'Select a hierarchy row to view properties';
    target.appendChild(empty);
    return;
  }
  const title = document.createElement('h2');
  title.className = 'json-viewer-panel-title';
  title.textContent = 'Properties';
  target.appendChild(title);
  for (const group of groupsFor(item, selectedRef)) if (group.rows.length) target.appendChild(renderGroup(group));
}

function renderGroup(group) {
  const section = document.createElement('section');
  section.className = 'json-viewer-property-section';
  const heading = document.createElement('h3');
  heading.textContent = group.title;
  const table = document.createElement('table');
  table.className = 'json-viewer-property-table';
  const body = document.createElement('tbody');
  for (const [key, value] of group.rows) body.appendChild(renderRow(key, value));
  table.appendChild(body);
  section.append(heading, table);
  return section;
}

function renderRow(key, value) {
  const tr = document.createElement('tr');
  const th = document.createElement('th');
  th.scope = 'row'; th.textContent = key;
  const td = document.createElement('td');
  td.textContent = displayValue(value);
  tr.append(th, td);
  return tr;
}

function objectRows(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value);
}

function attributeRows(item) {
  return objectRows({ ...(item?.attributes || {}), ...(item?.sourceAttributes || {}) });
}

function objectSummary(value) {
  return Object.entries(value).map(([key, item]) => `${key}: ${displayValue(item)}`).join('; ') || '-';
}

function bboxText(bbox) {
  return Array.isArray(bbox) && bbox.length >= 6 ? `min ${bbox.slice(0, 3).join(', ')} / max ${bbox.slice(3, 6).join(', ')}` : displayValue(bbox);
}
