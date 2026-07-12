/**
 * Renders the Stage JSON component tree.
 * Parameters: target element, StageModel, selected ref, and optional visibility/tag/filter state.
 * Outputs: DOM rows with selection, visibility, and tagging action data attributes.
 * Fallback: empty state is rendered when no staged model is loaded.
 */

function row(type, id, label, depth, selectedRef, meta, title, viewState, enrichedAttributes) {
  const ref = { type, id };
  const key = `${type}:${id}`;
  const tagged = tagKeys(viewState).has(key);
  const hidden = isHidden(ref, viewState);
  if (!passesFilter(type, key, hidden, tagged, selectedRef, viewState)) return null;
  const item = document.createElement('div');
  item.className = `json-viewer-tree-item${hidden ? ' is-hidden-row' : ''}${tagged ? ' is-tagged-row' : ''}`;
  item.style.setProperty('--json-tree-depth', String(depth));
  item.dataset.rowKind = type; item.dataset.rowHidden = String(hidden); item.dataset.rowTagged = String(tagged);
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'json-viewer-tree-checkbox';
  checkbox.checked = isSelectedKey(key, selectedRef, viewState);
  checkbox.dataset.checkType = type;
  checkbox.dataset.checkId = id;
  checkbox.setAttribute('aria-label', `Select ${label}`);

  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'json-viewer-tree-row';
  node.dataset.refType = type; node.dataset.refId = id;
  node.setAttribute('role', 'treeitem'); if (title) node.title = title;
  if (isSelected(type, id, selectedRef, viewState)) node.classList.add('is-selected');
  const name = document.createElement('span'); name.className = 'json-viewer-tree-name'; name.textContent = label;
  const badge = document.createElement('span'); badge.className = 'json-viewer-tree-badge'; badge.textContent = meta || type;
  const states = document.createElement('span'); states.className = 'json-viewer-tree-states';
  if (tagged) states.append(chip('TAG')); if (hidden) states.append(chip('HID'));
  
  if (enrichedAttributes) {
    const dot = document.createElement('span');
    dot.className = 'json-viewer-tree-enrich-dot';
    const conf = enrichedAttributes.enrichmentConfidence;
    const status = String(enrichedAttributes.status || conf || '').toLowerCase();
    const diagnostics = Array.isArray(enrichedAttributes.diagnostics) ? enrichedAttributes.diagnostics : [];
    const blocked = diagnostics.some((item) => String(item?.severity || '').toUpperCase() === 'BLOCKED');
    if (blocked || (enrichedAttributes.conflicts && enrichedAttributes.conflicts.length > 0)) {
      dot.classList.add('is-conflict');
      dot.title = blocked ? `${diagnostics.length} engineering issue(s); select to inspect` : 'Enrichment conflict';
    } else if (status === 'missing' || (!enrichedAttributes.lineNo && !isSupportEnrichment(enrichedAttributes))) {
      dot.classList.add('is-missing');
      dot.title = 'No enrichment match';
    } else if (['partial', 'review'].includes(status) || enrichedAttributes.needsReview) {
      dot.classList.add('is-partial');
      dot.title = 'Partial enrichment match';
    } else {
      dot.classList.add('is-full');
      dot.title = 'Full enrichment match';
    }
    states.append(dot);
  }

  node.append(name, states, badge);
  const actions = document.createElement('span'); actions.className = 'json-viewer-tree-actions';
  actions.append(actionButton(hidden ? 'Show' : 'Hide', type, id, 'visibility'), actionButton('Tag', type, id, 'tag'));
  item.append(checkbox, node, actions);
  return item;
}

function isSupportEnrichment(enrichedAttributes) {
  return String(enrichedAttributes?.componentType || '').toUpperCase() === 'SUPPORT';
}

function actionButton(text, type, id, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `json-viewer-tree-action json-viewer-tree-${action}`;
  button.textContent = text;
  if (action === 'visibility') {
    button.dataset.visibilityToggleType = type;
    button.dataset.visibilityToggleId = id;
    button.setAttribute('aria-pressed', text === 'Show' ? 'true' : 'false');
  } else {
    button.dataset.tagRowType = type;
    button.dataset.tagRowId = id;
  }
  return button;
}

function chip(text) {
  const span = document.createElement('span');
  span.className = 'json-viewer-tree-state';
  span.textContent = text;
  return span;
}

function childrenByParent(nodes, rootId) {
  const map = new Map();
  for (const node of nodes) {
    const parent = node.parentId || rootId || 'node-root';
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(node);
  }
  return map;
}

function primitiveCounts(primitives) {
  const map = new Map();
  for (const primitive of primitives || []) map.set(primitive.nodeId, (map.get(primitive.nodeId) || 0) + 1);
  return map;
}

function isWeak(node) {
  return (node.diagnostics || []).some((item) => String(item.code || '').includes('WEAK')) || /^CNTB_\d+$/i.test(node.name || '');
}

function renderNodeRows(fragment, node, context, selectedRef, depth, viewState) {
  const childCount = context.byParent.get(node.id)?.length || 0;
  const primCount = context.primitiveByNode.get(node.id) || 0;
  const weak = isWeak(node) ? ' weak' : '';
  appendRow(fragment, row('node', node.id, node.name || node.id, depth, selectedRef, `P:${primCount} C:${childCount}${weak}`, node.path || '', viewState, node.enrichedAttributes));
  for (const component of context.componentByNode.get(node.id) || []) {
    const label = component.name || component.semanticType || component.id;
    appendRow(fragment, row('component', component.id, label, depth + 1, selectedRef, component.semanticType || 'component', component.id, viewState, component.enrichedAttributes));
  }
  for (const child of context.byParent.get(node.id) || []) renderNodeRows(fragment, child, context, selectedRef, depth + 1, viewState);
}

export function renderHierarchyTree(target, model, selectedRef, viewState) {
  target.replaceChildren();
  if (!model) {
    const empty = document.createElement('div'); empty.className = 'json-viewer-empty-state'; empty.textContent = 'No staged model loaded'; target.appendChild(empty); return;
  }
  const nodes = Array.isArray(model.hierarchy?.nodes) ? model.hierarchy.nodes : [];
  const components = Array.isArray(model.components) ? model.components : [];
  const rootId = model.hierarchy?.rootId || 'node-root';
  const byParent = childrenByParent(nodes, rootId);
  const componentByNode = new Map();
  for (const component of components) {
    if (!componentByNode.has(component.nodeId)) componentByNode.set(component.nodeId, []);
    componentByNode.get(component.nodeId).push(component);
  }
  const context = { byParent, componentByNode, primitiveByNode: primitiveCounts(model.primitives) };
  const fragment = document.createDocumentFragment();
  appendRow(fragment, row('root', rootId, rootId, 0, selectedRef, `P:${context.primitiveByNode.get(rootId) || 0} C:${byParent.get(rootId)?.length || 0}`, rootId, viewState, null));
  for (const node of byParent.get(rootId) || []) renderNodeRows(fragment, node, context, selectedRef, 1, viewState);
  if (fragment.childNodes.length === 0 && components.length) for (const component of components) appendRow(fragment, row('component', component.id, component.name || component.id, 1, selectedRef, component.semanticType || 'component', component.id, viewState, component.enrichedAttributes));
  target.appendChild(fragment.childNodes.length ? fragment : emptyForFilter());
}

function appendRow(fragment, item) {
  if (item) fragment.appendChild(item);
}

function emptyForFilter() {
  const empty = document.createElement('div');
  empty.className = 'json-viewer-empty-state';
  empty.textContent = 'No component rows match the active filter';
  return empty;
}

function tagKeys(viewState) {
  if (viewState?.tagKeySet) return viewState.tagKeySet;
  return new Set((viewState?.tags || []).map((tag) => tag.ref?.type && tag.ref?.id ? `${tag.ref.type}:${tag.ref.id}` : '').filter(Boolean));
}

function isHidden(ref, viewState) {
  const key = `${ref.type}:${ref.id}`;
  return viewState?.hiddenKeys?.has?.(key) || (viewState?.isolateKey && viewState.isolateKey !== key);
}

function passesFilter(type, key, hidden, tagged, selectedRef, viewState) {
  const filter = viewState?.componentFilter || 'all';
  if (filter === 'components') return type === 'component';
  if (filter === 'hidden') return hidden;
  if (filter === 'tagged') return tagged;
  if (filter === 'selected') return isSelectedKey(key, selectedRef, viewState);
  return true;
}

function isSelected(type, id, selectedRef, viewState) {
  return isSelectedKey(`${type}:${id}`, selectedRef, viewState);
}

function isSelectedKey(key, selectedRef, viewState) {
  return key === `${selectedRef?.type}:${selectedRef?.id}` || viewState?.selectedKeys?.has?.(key);
}
