import * as THREE from 'three';
import { fitStagePreviewCamera } from './StagePreviewCameraControls.js';

export function attachStagePreviewMarqueeZoom(rendererState) {
  if (!rendererState || rendererState.marqueeZoom) return rendererState?.marqueeZoom;
  const canvas = rendererState.renderer.domElement;
  const rectEl = document.createElement('div');
  rectEl.className = 'json-viewer-marquee-rect';
  rectEl.hidden = true;
  rendererState.canvasHost.appendChild(rectEl);
  const state = { active: false, dragging: false, startX: 0, startY: 0, rectEl };
  state.onPointerDown = (event) => {
    if (!state.active) return;
    event.preventDefault();
    state.dragging = true;
    state.startX = event.clientX;
    state.startY = event.clientY;
    updateRect(state, event.clientX, event.clientY);
    rectEl.hidden = false;
    canvas.setPointerCapture?.(event.pointerId);
  };
  state.onPointerMove = (event) => { if (state.dragging) updateRect(state, event.clientX, event.clientY); };
  state.onPointerUp = (event) => {
    if (!state.dragging) return;
    state.dragging = false;
    rectEl.hidden = true;
    applyZoom(rendererState, state, event.clientX, event.clientY);
  };
  canvas.addEventListener('pointerdown', state.onPointerDown);
  canvas.addEventListener('pointermove', state.onPointerMove);
  canvas.addEventListener('pointerup', state.onPointerUp);
  rendererState.marqueeZoom = state;
  return state;
}

export function setStagePreviewMarqueeActive(rendererState, active) {
  const state = rendererState?.marqueeZoom;
  if (!state) return;
  state.active = active;
  rendererState.renderer.domElement.classList.toggle('mode-marquee', active);
}

export function detachStagePreviewMarqueeZoom(rendererState) {
  const state = rendererState?.marqueeZoom;
  if (!state) return;
  const canvas = rendererState.renderer.domElement;
  canvas.removeEventListener('pointerdown', state.onPointerDown);
  canvas.removeEventListener('pointermove', state.onPointerMove);
  canvas.removeEventListener('pointerup', state.onPointerUp);
  state.rectEl.remove();
  rendererState.marqueeZoom = null;
}

function updateRect(state, x, y) {
  const left = Math.min(state.startX, x), top = Math.min(state.startY, y);
  const width = Math.abs(x - state.startX), height = Math.abs(y - state.startY);
  const canvasBounds = state.rectEl.parentElement.getBoundingClientRect();
  Object.assign(state.rectEl.style, { left: `${left - canvasBounds.left}px`, top: `${top - canvasBounds.top}px`, width: `${width}px`, height: `${height}px` });
}

function applyZoom(rendererState, state, endX, endY) {
  const width = Math.abs(endX - state.startX), height = Math.abs(endY - state.startY);
  if (width < 6 || height < 6) return;
  const rectLeft = Math.min(state.startX, endX), rectTop = Math.min(state.startY, endY);
  const rect = { left: rectLeft, top: rectTop, right: rectLeft + width, bottom: rectTop + height };
  const box = collectBoxInRect(rendererState, rect);
  if (box) fitStagePreviewCamera(rendererState, box, { preserveOrientation: true });
}

function collectBoxInRect(rendererState, rect) {
  const canvasBounds = rendererState.renderer.domElement.getBoundingClientRect();
  const box3 = new THREE.Box3();
  let found = false;
  rendererState.rootGroup.traverse((object) => {
    if (!object.isMesh && !object.isLine && !object.isLineSegments) return;
    const objBox = new THREE.Box3().setFromObject(object);
    if (objBox.isEmpty()) return;
    if (!boxProjectsIntoRect(objBox, rendererState.camera, canvasBounds, rect)) return;
    box3.union(objBox);
    found = true;
  });
  if (!found) return null;
  return [box3.min.x, box3.min.y, box3.min.z, box3.max.x, box3.max.y, box3.max.z];
}

function boxProjectsIntoRect(box3, camera, canvasBounds, rect) {
  return boxCorners(box3)
    .map((corner) => projectToScreen(corner, camera, canvasBounds))
    .filter(Boolean)  // filter out behind-camera points (null)
    .some((point) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
}

function boxCorners(box3) {
  const { min, max } = box3;
  return [
    new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z), new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z), new THREE.Vector3(max.x, max.y, max.z),
  ];
}

function projectToScreen(point, camera, canvasBounds) {
  const projected = point.clone().project(camera);
  // Reject points behind the camera — z outside [-1, 1] in NDC means behind near/far plane
  if (projected.z < -1 || projected.z > 1) return null;
  return {
    x: canvasBounds.left + (projected.x * 0.5 + 0.5) * canvasBounds.width,
    y: canvasBounds.top + (1 - (projected.y * 0.5 + 0.5)) * canvasBounds.height,
  };
}
