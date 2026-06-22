import { Engine } from '@/core';
import { Color, MathUtils } from '@/core/math';
import { GLContext } from '@/render/gl';
import { Renderer, Camera } from '@/render';
import type { RenderSettings } from '@/render';
import { PhysicsWorld } from '@/physics';
import { Input } from '@/input';
import { AudioEngine } from '@/audio';
import { TweenManager } from '@/anim';
import { RenderSystem } from '@/scene';
import { Game } from './Game';

const overlay = document.getElementById('overlay') as HTMLElement;
const playline = document.getElementById('playline') as HTMLElement;
const spinner = document.getElementById('spinner') as HTMLElement;

const SETTINGS: RenderSettings = {
  exposure: 1.15,
  bloom: true,
  bloomStrength: 0.62,
  bloomThreshold: 1.1,
  fxaa: true,
  shadows: true,
  shadowMapSize: 2048,
  ambient: new Color(0.16, 0.18, 0.25),
  fogColor: new Color(0.05, 0.07, 0.12),
  fogDensity: 0.012,
  toneMapping: 'aces',
};

async function main(): Promise<void> {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;

  let engine: Engine;
  let input: Input;
  let audio: AudioEngine;
  try {
    const glx = new GLContext(canvas);

    engine = new Engine({ canvas, fixedTimeStep: 1 / 60, maxSubSteps: 5 });

    const camera = new Camera();
    camera.fov = 72 * MathUtils.DEG2RAD;
    camera.near = 0.1;
    camera.far = 500;

    input = engine.use(new Input(canvas));
    audio = engine.use(new AudioEngine());
    const tweens = engine.use(new TweenManager());
    const physics = engine.use(new PhysicsWorld());
    const renderer = engine.use(new Renderer(glx, SETTINGS));
    engine.use(new RenderSystem(engine.world, renderer, camera));
    engine.use(new Game({ engine, camera, input, audio, tweens, physics, renderer }));

    await engine.start();
  } catch (err) {
    console.error('[Aether] boot failed:', err);
    spinner.style.display = 'none';
    playline.innerHTML =
      `<span style="color:#ff8a8a">Failed to start.</span><br/>` +
      `<span style="font-size:11px">${escapeHtml(String(err))}</span>`;
    return;
  }

  // Engine is live and rendering behind the overlay. Reveal the "click to play".
  spinner.style.display = 'none';
  playline.innerHTML = 'Click to enter &nbsp;<b>▶</b>';

  let entered = false;
  const enter = (): void => {
    audio.resume();
    input.requestPointerLock();
    overlay.classList.add('hidden');
    entered = true;
  };
  overlay.addEventListener('click', enter);

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    document.body.classList.toggle('locked', locked);
    if (locked) {
      overlay.classList.add('hidden');
    } else if (entered) {
      // Player hit Esc — offer to resume.
      overlay.classList.remove('hidden');
      playline.innerHTML = 'Click to resume &nbsp;<b>▶</b>';
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

void main();
