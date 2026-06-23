import { Engine } from '@/core';
import { MathUtils } from '@/core/math';
import { GLContext } from '@/render/gl';
import { Renderer, Camera } from '@/render';
import { RenderSystem } from '@/scene';
import { EditorContext } from '@editor/core';
import { Viewport } from '@editor/viewport';
import { HierarchyPanel } from '@editor/panels/HierarchyPanel';
import { InspectorPanel } from '@editor/panels/InspectorPanel';
import { Toolbar } from '@editor/panels/Toolbar';

/**
 * Aether Editor bootstrap. Spins up the engine + renderer into the viewport
 * canvas, builds the EditorContext hub, mounts the panels, seeds a scene
 * (restoring the last autosave or loading the sample), and starts the loop.
 */
async function main(): Promise<void> {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;

  const glx = new GLContext(canvas);
  const engine = new Engine({ canvas, fixedTimeStep: 1 / 60, maxSubSteps: 5 });

  const camera = new Camera();
  camera.fov = 55 * MathUtils.DEG2RAD;
  camera.near = 0.05;
  camera.far = 1000;

  const renderer = engine.use(new Renderer(glx, {}));
  engine.use(new RenderSystem(engine.world, renderer, camera));
  // Keep the camera aspect in sync with the viewport canvas.
  engine.use({ name: 'aspect', resize: (w: number, h: number) => camera.setAspect(w / Math.max(1, h)) });

  const ctx = new EditorContext(engine, renderer, camera);
  // Debug hook for tooling/tests (harmless; lets harnesses introspect state).
  (window as unknown as { aether?: unknown }).aether = { ctx, engine, camera };

  // Panels (each finds its own container and wires itself to ctx.events).
  new Toolbar(ctx);
  new HierarchyPanel(ctx);
  new InspectorPanel(ctx);
  new Viewport(ctx);

  // Seed: restore the last autosave, otherwise load the sample scene.
  if (!ctx.loadFromStorage()) ctx.loadSample();

  // Autosave to browser storage periodically and on unload.
  setInterval(() => { if (ctx.mode === 'edit') ctx.saveToStorage(); }, 20000);
  window.addEventListener('beforeunload', () => { if (ctx.mode === 'edit') ctx.saveToStorage(); });

  await engine.start();
  ctx.status('Ready — click an object to select, drag the gizmo to edit', 'ok');
}

void main();
