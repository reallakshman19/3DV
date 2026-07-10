import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDiagnostics } from '../stage/ui/JsonViewerDiagnosticsPanel.js';
import { createStageWorkerRuntime, runStageWorkerJob } from '../stage/worker/StageWorkerRuntime.js';
import { createStageJsonWorkerJob } from '../stage/worker/StageWorkerJob.js';

test('ATT-managed hierarchy JSON with no position attributes is accepted as a hierarchy-only StageModel', async () => {
  const text = JSON.stringify([
    { name: '/LINE/B1', type: 'BRANCH', bore: '250mm', attributes: { NAME: '/LINE/B1' }, children: [
      { name: 'ELBO =123/45', type: 'ELBO', attributes: { ANGL: '90degree' } },
    ] },
  ]);
  const job = createStageJsonWorkerJob({ text, fileName: 'RMSS_ATTRIBUTE_managed_stage.json', fileSize: text.length, fileHash: 'sha256-att-managed-json' });
  const result = await runStageWorkerJob(createStageWorkerRuntime(), job);
  assert.equal(result.ok, true, result.error?.message || 'expected worker success');
  assert.equal(result.stageModel.schema, 'RvmStageModel.v1');
  assert.equal(result.stageModel.source.kind, 'att-managed-hierarchy');
  assert.equal(result.stageModel.source.attAvailable, true);
  assert.equal(result.stageModel.primitives.length, 0);
  assert.equal(result.stageModel.hierarchy.nodes.length, 2);
  const branch = result.stageModel.hierarchy.nodes.find((node) => node.name === '/LINE/B1');
  assert.ok(branch);
  assert.equal(branch.kind, 'BRANCH');
  assert.equal(branch.attributes.bore, '250mm');
  const elbow = result.stageModel.hierarchy.nodes.find((node) => node.name.startsWith('ELBO'));
  assert.ok(elbow);
  assert.equal(elbow.parentId, branch.id);
  const noGeometryDiagnostic = result.stageModel.diagnostics.messages.find((message) => message.code === 'STAGE_ATT_HIERARCHY_NO_GEOMETRY');
  assert.ok(noGeometryDiagnostic);
  assertDiagnosticsPanelShows(result.stageModel.diagnostics);
});

test('ATT-managed hierarchy JSON with APOS/LPOS/POS synthesizes schematic geometry', async () => {
  const text = JSON.stringify([
    { name: '/LINE/B1', type: 'BRANCH', attributes: { NAME: '/LINE/B1' }, children: [
      { name: 'PIPE AUTO', type: 'PIPE', attributes: { APOS: { x: 0, y: 0, z: 0 }, LPOS: { x: 1000, y: 0, z: 0 }, ABORE: '250mm' } },
      { name: 'VALV =1', type: 'VALV', attributes: { APOS: { x: 1000, y: 0, z: 0 }, LPOS: { x: 1000, y: 0, z: 0 }, ABORE: '250mm' } },
      { name: 'SUPPORT PS-1', type: 'SUPPORT', attributes: { POS: { x: 500, y: 0, z: 0 }, ABORE: '250mm', SUPPORT_TAG: 'PS-1', SUPPORT_TYPE: 'GUIDE', CMPSUPTYPE: 'GUIDE', DTXR: 'Pipe Guide', NODEGAP: '2mm' } },
    ] },
  ]);
  const job = createStageJsonWorkerJob({ text, fileName: 'positioned.json', fileSize: text.length, fileHash: 'sha256-att-positioned' });
  const result = await runStageWorkerJob(createStageWorkerRuntime(), job);
  assert.equal(result.ok, true, result.error?.message || 'expected worker success');
  assert.equal(result.stageModel.primitives.length, 3);
  const pipePrim = result.stageModel.primitives.find((p) => p.renderKind === 'CYLINDER');
  assert.ok(pipePrim);
  assert.equal(pipePrim.nativeParams.radius, 125);
  assert.deepEqual(pipePrim.nativeParams.startPoint, { x: 0, y: 0, z: 0 });
  assert.deepEqual(pipePrim.nativeParams.endPoint, { x: 1000, y: 0, z: 0 });
  assert.equal(pipePrim.confidence.geometry, 'derived');
  const valvPrim = result.stageModel.primitives.find((p) => p.renderKind === 'SPHERE');
  assert.ok(valvPrim, 'zero-length APOS===LPOS should synthesize a SPHERE marker instead of a degenerate cylinder');
  const supportPrim = result.stageModel.primitives.find((p) => p.nativeParams?.role === 'supportShoe');
  assert.ok(supportPrim);
  assert.equal(supportPrim.attributes.SUPPORT_TYPE, 'GUIDE');
  assert.equal(supportPrim.sourceAttributes.CMPSUPTYPE, 'GUIDE');
  assert.equal(supportPrim.sourceAttributes.DTXR, 'Pipe Guide');
  const schematicDiagnostic = result.stageModel.diagnostics.messages.find((message) => message.code === 'STAGE_ATT_HIERARCHY_SCHEMATIC_GEOMETRY');
  assert.ok(schematicDiagnostic);
});

function assertDiagnosticsPanelShows(diagnostics) {
  const originalDocument = globalThis.document;
  globalThis.document = createDocument();
  const target = globalThis.document.createElement('div');
  renderDiagnostics(target, diagnostics, [], [], []);
  assert.match(target.textContent, /no facet\/mesh geometry/);
  globalThis.document = originalDocument;
}

function createDocument() {
  return { createElement: (tag) => createElement(tag) };
}

function createElement(tag) {
  return {
    tag,
    className: '',
    children: [],
    _text: '',
    set textContent(value) { this._text = String(value); },
    get textContent() { return [this._text, ...this.children.map((child) => child.textContent)].join(''); },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
  };
}
