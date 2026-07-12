/**
 * Integration contract test using the user-provided real stagedJson benchmark.
 * It proves enrichment/diagnostic preservation and Sel-E/Sel-N inheritance.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildJsonViewerSelectionPayload } from '../stage/export/JsonViewerSelectionExport.js';
import { buildStageModelFromAttManagedHierarchy } from '../stage/parser/AttManagedHierarchyToStageModel.js';
import { summarizeJsonViewerDataHealth } from '../stage/ui/JsonViewerDataHealth.js';

const BENCHMARK = 'C:/Code3/Vertical load benchmark/benchmark_30_complex_3d_support_load_stagedjson.json';

test('viewer preserves enrichedAttributes and exports inherited Sel-E/Sel-N data', async () => {
  const staged = JSON.parse(await readFile(BENCHMARK, 'utf8'));
  const model = buildStageModelFromAttManagedHierarchy(staged, { fileName: 'benchmark.json', fileSize: 1, fileHash: 'benchmark' });
  const pipeNode = model.hierarchy.nodes.find((node) => node.sourceId === 'E001');
  assert.ok(pipeNode);
  assert.equal(pipeNode.enrichedAttributes.schema, 'stagedjson-cii2019-enriched-attributes/v1');
  assert.equal(pipeNode.enrichedAttributes.fluidDensityHydKgM3, 1000);
  const health = summarizeJsonViewerDataHealth(model);
  assert.equal(health.enrichedNodes, 30);
  assert.equal(health.blocked, 0);

  const primitiveId = pipeNode.primitiveIds[0];
  const element = buildJsonViewerSelectionPayload(model, 'benchmark.json', [{ type: 'primitive', id: primitiveId }], 'element');
  assert.equal(element.schema, 'json-viewer-selection/v1');
  assert.equal(element.selectionMode, 'element');
  assert.deepEqual(element.selected[0].item.enrichedAttributes, pipeNode.enrichedAttributes);
  assert.ok(element.selected[0].item.nativeParams.startPoint);
  assert.equal(element.selected[0].item.sourceAttributes.CHAINAGE_START_MM, 0);

  const node = buildJsonViewerSelectionPayload(model, 'benchmark.json', [{ type: 'node', id: pipeNode.id }], 'node');
  assert.equal(node.selectionMode, 'node');
  assert.deepEqual(node.selected[0].item.enrichedAttributes, pipeNode.enrichedAttributes);
  assert.ok(node.selected[0].item.primitives.length > 0);
});

test('Attr+ remains available but is visibly marked Draft', async () => {
  const shellSource = await readFile(new URL('../stage/ui/JsonViewerShell.js', import.meta.url), 'utf8');
  assert.match(shellSource, /Attr\+ Draft/);
  assert.match(shellSource, /DRAFT: experimental viewer-side attribute population/);
});
