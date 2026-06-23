import type { EditorContext, EditorObject, PrimitiveKind, LightKind } from '@editor/core';
import { LightType } from '@/render';
import { el, clear, button } from '@editor/ui/dom';

/** Icon glyphs keyed by primitive kind. */
const PRIMITIVE_ICONS: Record<PrimitiveKind, string> = {
  box: '\u{1F4E6}',      // package/cube
  sphere: '\u{1F535}',   // blue circle
  plane: '\u{25AC}',     // black rectangle
  cylinder: '\u{1F6E2}', // oil drum
  capsule: '\u{1F48A}',  // pill
  torus: '\u{1F369}',    // doughnut
};

/** Icon glyphs keyed by light kind. */
const LIGHT_ICONS: Record<LightKind, string> = {
  directional: '☀',  // sun
  point: '\u{1F4A1}',     // bulb
  spot: '\u{1F526}',      // flashlight
};

/** Pick a small text/emoji icon for an object based on its components. */
function iconFor(obj: EditorObject): string {
  if (obj.light) {
    const kind: LightKind =
      obj.light.type === LightType.Directional ? 'directional'
      : obj.light.type === LightType.Point ? 'point'
      : 'spot';
    return LIGHT_ICONS[kind] ?? '\u{1F4A1}';
  }
  if (obj.primitive) return PRIMITIVE_ICONS[obj.primitive] ?? '\u{1F4E6}';
  return '◈'; // empty/diamond
}

/**
 * Left-side scene tree. Lists every object in the scene as a clickable row with
 * a type icon, name, and a delete button. Clicking a row selects the object;
 * the selected row is highlighted. Rebuilds on the 'hierarchy' event and updates
 * only the highlight on 'selection'.
 */
export class HierarchyPanel {
  private readonly ctx: EditorContext;
  private readonly tree: HTMLElement;
  /** Row element by object id, so 'selection' updates avoid a full rebuild. */
  private rows = new Map<number, HTMLElement>();

  constructor(ctx: EditorContext) {
    this.ctx = ctx;

    const host = document.getElementById('hierarchy');
    if (!host) throw new Error('HierarchyPanel: #hierarchy element not found');

    this.tree = el('div', { class: 'tree' });
    host.append(this.tree);

    ctx.events.on('hierarchy', () => this.rebuild());
    ctx.events.on('selection', () => this.updateHighlight());

    this.rebuild();
  }

  /** Rebuild every row from the current scene objects. */
  private rebuild(): void {
    clear(this.tree);
    this.rows.clear();

    const objects = this.ctx.scene.objects;
    if (objects.length === 0) {
      this.tree.append(el('div', { class: 'empty', text: 'No objects — add one from the toolbar' }));
      return;
    }

    for (const obj of objects) {
      this.tree.append(this.buildRow(obj));
    }
    this.updateHighlight();
  }

  /** Build a single `.tree .row` for an object. */
  private buildRow(obj: EditorObject): HTMLElement {
    const del = button('×', () => {}, 'del');
    del.title = 'Delete';
    del.addEventListener('click', (e) => {
      e.stopPropagation(); // don't also select the row
      this.ctx.delete(obj);
    });

    const row = el('div', { class: 'row', onclick: () => this.ctx.select(obj) }, [
      el('span', { class: 'ico', text: iconFor(obj) }),
      el('span', { class: 'nm', text: obj.name, title: obj.name }),
      del,
    ]);

    this.rows.set(obj.id, row);
    return row;
  }

  /** Toggle the 'selected' class so it matches `ctx.selection`. */
  private updateHighlight(): void {
    const selId = this.ctx.selection?.id;
    for (const [id, row] of this.rows) {
      row.classList.toggle('selected', id === selId);
    }
  }
}
