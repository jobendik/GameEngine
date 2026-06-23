import type { EditorContext } from '@editor/core';
import type { GizmoMode, LightKind, PrimitiveKind } from '@editor/core';
import { el, button } from '@editor/ui/dom';

/** A labeled primitive entry: the visible label may differ from the engine kind. */
interface MeshEntry {
  label: string;
  primitive: PrimitiveKind;
}

const MESHES: MeshEntry[] = [
  { label: 'Cube', primitive: 'box' },
  { label: 'Sphere', primitive: 'sphere' },
  { label: 'Plane', primitive: 'plane' },
  { label: 'Cylinder', primitive: 'cylinder' },
  { label: 'Capsule', primitive: 'capsule' },
  { label: 'Torus', primitive: 'torus' },
];

const LIGHTS: { label: string; kind: LightKind }[] = [
  { label: 'Dir', kind: 'directional' },
  { label: 'Point', kind: 'point' },
  { label: 'Spot', kind: 'spot' },
];

/**
 * The top toolbar: add-mesh / add-light buttons, gizmo-mode toggles, the
 * play/stop button, and scene file commands. Mounts into `#toolbar`, drives the
 * editor purely through {@link EditorContext} commands, and restyles its gizmo /
 * play buttons in response to the `'gizmo'` and `'mode'` events. Also installs
 * the global W/E/R and Delete keyboard shortcuts.
 */
export class Toolbar {
  private readonly ctx: EditorContext;
  /** Gizmo toggle buttons keyed by the mode they activate. */
  private readonly gizmoButtons = new Map<GizmoMode, HTMLButtonElement>();
  private playButton!: HTMLButtonElement;

  constructor(ctx: EditorContext) {
    this.ctx = ctx;
    const root = document.getElementById('toolbar');
    if (!root) throw new Error('Toolbar: #toolbar element not found');

    this.build(root);

    ctx.events.on('gizmo', () => this.syncGizmo());
    ctx.events.on('mode', () => this.syncPlay());
    window.addEventListener('keydown', this.onKeyDown);
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  private build(root: HTMLElement): void {
    root.append(el('span', { class: 'brand', html: 'AETHER <b>EDITOR</b>' }));

    // Add mesh primitives.
    root.append(this.sep());
    for (const m of MESHES) {
      root.append(
        button(m.label, () => this.ctx.add({ kind: 'mesh', primitive: m.primitive, position: [0, 1, 0] })),
      );
    }

    // Add lights.
    root.append(this.sep());
    for (const l of LIGHTS) {
      root.append(
        button(l.label, () => this.ctx.add({ kind: 'light', lightKind: l.kind, position: [0, 3, 0] })),
      );
    }

    // Gizmo mode toggles.
    root.append(this.sep());
    root.append(this.gizmoButton('Move', 'translate'));
    root.append(this.gizmoButton('Rotate', 'rotate'));
    root.append(this.gizmoButton('Scale', 'scale'));

    // Push the rest to the right.
    root.append(el('span', { class: 'spacer' }));

    // Play / Stop.
    this.playButton = button('▶ Play', () => this.ctx.togglePlay());
    root.append(this.playButton);

    // Scene file commands.
    root.append(this.sep());
    root.append(button('New', () => this.ctx.newScene()));
    root.append(button('Save', () => this.ctx.saveToStorage()));
    root.append(button('Load', () => this.ctx.loadFromStorage()));
    root.append(button('Sample', () => this.ctx.loadSample()));
    root.append(button('Export', () => this.ctx.downloadScene()));

    this.syncGizmo();
    this.syncPlay();
  }

  private sep(): HTMLSpanElement {
    return el('span', { class: 'sep' });
  }

  private gizmoButton(label: string, mode: GizmoMode): HTMLButtonElement {
    const b = button(label, () => this.ctx.setGizmoMode(mode));
    this.gizmoButtons.set(mode, b);
    return b;
  }

  // ---------------------------------------------------------------------------
  // Event sync
  // ---------------------------------------------------------------------------

  /** Reflect the current gizmo mode by toggling the `active` class. */
  private syncGizmo(): void {
    for (const [mode, b] of this.gizmoButtons) {
      b.classList.toggle('active', this.ctx.gizmoMode === mode);
    }
  }

  /** Reflect play/edit mode on the play/stop button. */
  private syncPlay(): void {
    const playing = this.ctx.mode === 'play';
    this.playButton.textContent = playing ? '■ Stop' : '▶ Play';
    this.playButton.classList.toggle('primary', playing);
    this.playButton.classList.toggle('active', playing);
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // Ignore while typing into a form control (e.g. renaming an object).
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case 'w':
      case 'W':
        this.ctx.setGizmoMode('translate');
        break;
      case 'e':
      case 'E':
        this.ctx.setGizmoMode('rotate');
        break;
      case 'r':
      case 'R':
        this.ctx.setGizmoMode('scale');
        break;
      case 'Delete':
      case 'Backspace':
        if (this.ctx.selection) {
          e.preventDefault();
          this.ctx.delete(this.ctx.selection);
        }
        break;
      default:
        return;
    }
  };
}
