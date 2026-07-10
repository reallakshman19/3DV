import * as THREE from 'three';

const MIN_RADIUS = 0.001;
const MAX_RADIUS = 1000000;
const MIN_PITCH = -Math.PI / 2 + 0.05;
const MAX_PITCH = Math.PI / 2 - 0.05;

export function attachStagePreviewCameraControls(rendererState) {
  if (!rendererState || rendererState.cameraControls) return rendererState?.cameraControls;
  const canvas = rendererState.renderer.domElement;
  const controls = createControls(rendererState);
  controls.onPointerDown = (event) => pointerDown(event, controls);
  controls.onPointerMove = (event) => pointerMove(event, controls);
  controls.onPointerUp = (event) => pointerUp(event, controls);
  controls.onWheel = (event) => wheel(event, controls);
  canvas.addEventListener('pointerdown', controls.onPointerDown);
  window.addEventListener('pointermove', controls.onPointerMove);
  window.addEventListener('pointerup', controls.onPointerUp);
  canvas.addEventListener('wheel', controls.onWheel, { passive: false });
  rendererState.cameraControls = controls;
  return controls;
}

export function detachStagePreviewCameraControls(rendererState) {
  const controls = rendererState?.cameraControls;
  if (!controls) return;
  if (controls.rafId) { cancelAnimationFrame(controls.rafId); controls.rafId = null; }
  const canvas = rendererState.renderer.domElement;
  canvas.removeEventListener('pointerdown', controls.onPointerDown);
  window.removeEventListener('pointermove', controls.onPointerMove);
  window.removeEventListener('pointerup', controls.onPointerUp);
  canvas.removeEventListener('wheel', controls.onWheel);
  rendererState.cameraControls = null;
}

export function fitStagePreviewCamera(rendererState, bbox, options = {}) {
  const controls = rendererState?.cameraControls || attachStagePreviewCameraControls(rendererState);
  if (!controls) return;
  const sphere = bboxSphere(bbox);
  const yaw = controls.yaw;
  const pitch = controls.pitch;
  controls.target.copy(sphere.target);
  // Use FOV-aware distance: r / sin(fov/2) gives correct framing for any camera FOV
  const fovRad = ((rendererState.camera?.fov || controls.rendererState?.camera?.fov || 45) * Math.PI) / 180;
  controls.radius = clamp(sphere.radius / Math.sin(fovRad / 2), MIN_RADIUS, MAX_RADIUS);
  controls.defaultTarget.copy(controls.target);
  controls.defaultRadius = controls.radius;
  controls.yaw = options.preserveOrientation === true ? yaw : Math.PI / 4;
  controls.pitch = options.preserveOrientation === true ? pitch : Math.PI / 6;
  controls.initialized = true;
  updateCamera(controls);
}

export function resetStagePreviewCamera(rendererState) {
  const controls = rendererState?.cameraControls;
  if (!controls) return;
  controls.target.copy(controls.defaultTarget);
  controls.radius = controls.defaultRadius || controls.radius || 10;
  controls.yaw = Math.PI / 4;
  controls.pitch = Math.PI / 6;
  updateCamera(controls);
}

const VIEW_PRESETS = Object.freeze({
  ISO: { yaw: Math.PI / 4, pitch: Math.PI / 6 },
  TOP: { yaw: 0, pitch: Math.PI / 2 - 0.02 },
  FRONT: { yaw: 0, pitch: 0 },
  SIDE: { yaw: Math.PI / 2, pitch: 0 },
});

export function setStagePreviewCameraMode(rendererState, mode) {
  const controls = rendererState?.cameraControls;
  if (!controls) return;
  controls.mode = ['orbit', 'pan', 'select'].includes(mode) ? mode : 'orbit';
}

export function setStagePreviewView(rendererState, preset) {
  const controls = rendererState?.cameraControls;
  const spec = VIEW_PRESETS[String(preset || '').toUpperCase()];
  if (!controls || !spec) return;
  pushCameraViewSnapshot(controls);
  controls.yaw = spec.yaw;
  controls.pitch = spec.pitch;
  if (rendererState.currentBbox) {
    fitStagePreviewCamera(rendererState, rendererState.currentBbox);
    controls.yaw = spec.yaw;
    controls.pitch = spec.pitch;
  }
  updateCamera(controls);
}

function createControls(rendererState) {
  return {
    rendererState,
    target: new THREE.Vector3(),
    defaultTarget: new THREE.Vector3(),
    radius: 10,
    defaultRadius: 10,
    yaw: Math.PI / 4,
    pitch: Math.PI / 6,
    active: false,
    mode: 'select',
    lastX: 0,
    lastY: 0,
    initialized: false,
    velocityYaw: 0,
    velocityPitch: 0,
    velocityPanX: 0,
    velocityPanY: 0,
    dampingFactor: 0.085,
    rafId: null,
    viewHistory: [],
    viewHistoryIndex: -1,
    VIEW_HISTORY_MAX: 32,
    hasDragged: false,
    wheelTimer: null,
  };
}

function pointerDown(event, controls) {
  if (event.button !== 0 && event.pointerType !== 'touch') return;
  if (controls.mode === 'select') return;
  event.preventDefault();
  controls.active = true;
  controls.lastX = event.clientX;
  controls.lastY = event.clientY;
  controls.velocityYaw = controls.velocityPitch = 0;
  controls.velocityPanX = controls.velocityPanY = 0;
  controls.hasDragged = false;
  if (controls.rafId) { cancelAnimationFrame(controls.rafId); controls.rafId = null; }
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function pointerMove(event, controls) {
  if (!controls.active) return;
  controls.hasDragged = true;
  event.preventDefault();
  const dx = event.clientX - controls.lastX;
  const dy = event.clientY - controls.lastY;
  controls.lastX = event.clientX;
  controls.lastY = event.clientY;
  if (controls.mode === 'select') return;
  if (controls.mode === 'pan') { 
    const scale = controls.radius * 0.0016;
    controls.velocityPanX += -dx * scale;
    controls.velocityPanY += dy * scale;
    ensureDampingLoop(controls);
    return; 
  }
  controls.velocityYaw -= dx * 0.008;
  controls.velocityPitch -= dy * 0.008;
  ensureDampingLoop(controls);
}

function ensureDampingLoop(controls) {
  if (controls.rafId) return;
  function tick() {
    let dirty = false;
    if (Math.abs(controls.velocityYaw) > 0.0001 || Math.abs(controls.velocityPitch) > 0.0001) {
      controls.yaw += controls.velocityYaw;
      controls.pitch = clamp(controls.pitch + controls.velocityPitch, MIN_PITCH, MAX_PITCH);
      controls.velocityYaw *= (1 - controls.dampingFactor);
      controls.velocityPitch *= (1 - controls.dampingFactor);
      dirty = true;
    } else {
      controls.velocityYaw = 0;
      controls.velocityPitch = 0;
    }
    
    if (Math.abs(controls.velocityPanX) > 0.0001 || Math.abs(controls.velocityPanY) > 0.0001) {
      const { camera } = controls.rendererState;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      controls.target.addScaledVector(right, controls.velocityPanX);
      controls.target.addScaledVector(up, controls.velocityPanY);
      controls.velocityPanX *= (1 - controls.dampingFactor);
      controls.velocityPanY *= (1 - controls.dampingFactor);
      dirty = true;
    } else {
      controls.velocityPanX = 0;
      controls.velocityPanY = 0;
    }
    
    if (dirty) {
      updateCamera(controls);
      controls.rafId = requestAnimationFrame(tick);
    } else {
      controls.rafId = null;
    }
  }
  controls.rafId = requestAnimationFrame(tick);
}

function panCamera(controls, dx, dy) {
  const { camera } = controls.rendererState;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const scale = controls.radius * 0.0016;
  controls.target.addScaledVector(right, -dx * scale);
  controls.target.addScaledVector(up, dy * scale);
  updateCamera(controls);
}

function pointerUp(event, controls) {
  if (!controls.active) return;
  event.preventDefault();
  controls.active = false;
  if (controls.hasDragged) {
    pushCameraViewSnapshot(controls);
    controls.hasDragged = false;
  }
}

function wheel(event, controls) {
  event.preventDefault();
  const before = pointerTargetPlanePoint(event, controls);
  const factor = Math.exp(Math.sign(event.deltaY) * 0.12);
  controls.radius = clamp(controls.radius * factor, MIN_RADIUS, MAX_RADIUS);
  updateCamera(controls);
  const after = pointerTargetPlanePoint(event, controls);
  if (before && after) {
    controls.target.add(before.sub(after));
    updateCamera(controls);
  }
  clearTimeout(controls.wheelTimer);
  controls.wheelTimer = setTimeout(() => pushCameraViewSnapshot(controls), 600);
}

function updateCamera(controls) {
  const state = controls.rendererState;
  const { camera, renderer, scene } = state;
  const x = Math.cos(controls.pitch) * Math.cos(controls.yaw) * controls.radius;
  const y = Math.sin(controls.pitch) * controls.radius;
  const z = Math.cos(controls.pitch) * Math.sin(controls.yaw) * controls.radius;
  
  // Tighter near/far ratio (20,000:1 vs old 1,000,000:1) reduces Z-fighting significantly.
  // Combined with logarithmicDepthBuffer in the renderer this is very effective.
  const sceneRadius = rendererSceneRadius(state, controls.radius);
  const near = Math.max(Math.min(controls.radius / 1000, sceneRadius / 10000), 0.001);
  const far = Math.max(controls.radius + sceneRadius * 6, controls.radius * 20, 5000);

  if (state.perspCamera) {
    state.perspCamera.position.copy(controls.target).add(new THREE.Vector3(x, y, z));
    state.perspCamera.near = near;
    state.perspCamera.far = far;
    state.perspCamera.lookAt(controls.target);
    state.perspCamera.updateProjectionMatrix();
  } else {
    camera.position.copy(controls.target).add(new THREE.Vector3(x, y, z));
    camera.near = near;
    camera.far = far;
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
  }

  if (state.projectionMode === 'orthographic') {
    const r = controls.radius;
    const aspect = state.camera.aspect || 1;
    state.orthoCamera.left   = -r * aspect;
    state.orthoCamera.right  =  r * aspect;
    state.orthoCamera.top    =  r;
    state.orthoCamera.bottom = -r;
    // Dynamically update ortho near/far to match persp — previously hardcoded, causing Z-fighting
    state.orthoCamera.near = near;
    state.orthoCamera.far  = far;
    state.orthoCamera.position.copy(state.perspCamera.position);
    state.orthoCamera.quaternion.copy(state.perspCamera.quaternion);
    state.orthoCamera.updateProjectionMatrix();
  }
  
  renderer.render(scene, state.camera);
  state.onCameraUpdate?.(state.camera);
}

function bboxSphere(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 6) return { target: new THREE.Vector3(), radius: 4 };
  const target = new THREE.Vector3((bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2);
  const size = new THREE.Vector3(bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]);
  return { target, radius: Math.max(size.length() / 2, 0.01) };
}

function rendererSceneRadius(state, fallback) {
  return bboxSphere(state?.currentBbox).radius || fallback || 4;
}

function pointerTargetPlanePoint(event, controls) {
  const { camera, renderer } = controls.rendererState;
  const bounds = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
    -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1),
  );
  const raycaster = new THREE.Raycaster();
  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, controls.target);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function pushCameraViewSnapshot(controls) {
  if (!controls) return;
  const snap = {
    yaw: controls.yaw,
    pitch: controls.pitch,
    radius: controls.radius,
    target: controls.target.clone(),
  };
  controls.viewHistory = controls.viewHistory.slice(0, controls.viewHistoryIndex + 1);
  controls.viewHistory.push(snap);
  if (controls.viewHistory.length > controls.VIEW_HISTORY_MAX) controls.viewHistory.shift();
  controls.viewHistoryIndex = controls.viewHistory.length - 1;
}

export function stepCameraViewHistory(controls, direction) {
  if (!controls) return false;
  const nextIndex = controls.viewHistoryIndex + (direction === 'prev' ? -1 : 1);
  if (nextIndex < 0 || nextIndex >= controls.viewHistory.length) return false;
  controls.viewHistoryIndex = nextIndex;
  const snap = controls.viewHistory[nextIndex];
  controls.yaw = snap.yaw;
  controls.pitch = snap.pitch;
  controls.radius = snap.radius;
  controls.target.copy(snap.target);
  updateCamera(controls);
  return true;
}

export function pushStagePreviewCameraSnapshot(rendererState) {
  pushCameraViewSnapshot(rendererState?.cameraControls);
}

export function stepStagePreviewCameraHistory(rendererState, direction) {
  return stepCameraViewHistory(rendererState?.cameraControls, direction);
}
