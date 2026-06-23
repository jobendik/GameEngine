import type {
  EditorContext, SelectedAsset, AssetType, ScriptAsset, MaterialAsset, PrefabAsset,
} from '@editor/core';
import { el, clear, button } from '@editor/ui/dom';

const ICON: Record<AssetType, string> = { script: '\u{1F4DC}', material: '\u{1F3A8}', prefab: '\u{1F4E6}' };
const TAB_LABEL: Record<AssetType, string> = { script: 'Scripts', material: 'Materials', prefab: 'Prefabs' };
const USE_TITLE: Record<AssetType, string> = {
  script: 'Attach to selected object', material: 'Assign to selected object', prefab: 'Instantiate into scene',
};
const EMPTY: Record<AssetType, string> = {
  script: 'No script assets. Create one with "+ Script" — reuse it on many objects.',
  material: 'No material assets. Create one with "+ Material" — share it across objects.',
  prefab: 'No prefabs. Select an object and click "Save Prefab" to make a reusable template.',
};

type Item =
  | { type: 'script'; asset: ScriptAsset }
  | { type: 'material'; asset: MaterialAsset }
  | { type: 'prefab'; asset: PrefabAsset };

/**
 * Bottom Assets dock: a tabbed library of reusable project resources (Script,
 * Material, Prefab assets). Click a card to edit it in the inspector, the green
 * `+` to use it on the current selection (attach / assign / instantiate), or `×`
 * to delete. Create new assets from the header buttons.
 */
export class AssetPanel {
  private readonly ctx: EditorContext;
  private readonly grid: HTMLElement;
  private tab: AssetType = 'script';
  private readonly tabButtons = new Map<AssetType, HTMLButtonElement>();

  constructor(ctx: EditorContext) {
    this.ctx = ctx;
    const host = document.getElementById('assets');
    if (!host) throw new Error('AssetPanel: #assets element not found');

    const head = el('div', { class: 'assets-head' });
    head.append(el('span', { class: 'title', text: 'Assets' }));
    for (const t of ['script', 'material', 'prefab'] as AssetType[]) {
      const b = button(TAB_LABEL[t], () => this.setTab(t), 'tab');
      this.tabButtons.set(t, b);
      head.append(b);
    }
    head.append(el('span', { class: 'spacer' }));
    head.append(button('+ Script', () => ctx.createScriptAsset()));
    head.append(button('+ Material', () => ctx.createMaterialAsset()));
    head.append(button('Save Prefab', () => ctx.createPrefabFromSelection()));
    host.append(head);

    this.grid = el('div', { class: 'assets-grid' });
    host.append(this.grid);

    ctx.events.on('assets', () => this.rebuild());
    ctx.events.on('assetSelection', () => this.updateHighlight());

    this.setTab('script');
  }

  private setTab(t: AssetType): void {
    this.tab = t;
    for (const [k, b] of this.tabButtons) b.classList.toggle('active', k === t);
    this.rebuild();
  }

  private items(): Item[] {
    const a = this.ctx.assets;
    if (this.tab === 'script') return a.scripts.map((s) => ({ type: 'script', asset: s }));
    if (this.tab === 'material') return a.materials.map((m) => ({ type: 'material', asset: m }));
    return a.prefabs.map((p) => ({ type: 'prefab', asset: p }));
  }

  private rebuild(): void {
    clear(this.grid);
    const items = this.items();
    if (items.length === 0) {
      this.grid.append(el('div', { class: 'assets-empty', text: EMPTY[this.tab] }));
      return;
    }
    for (const it of items) this.grid.append(this.card(it));
    this.updateHighlight();
  }

  private card(it: Item): HTMLElement {
    const ctx = this.ctx;
    const sel = { type: it.type, asset: it.asset } as SelectedAsset;
    const card = el('div', {
      class: 'asset-card',
      attrs: { 'data-id': String(it.asset.id) },
      onclick: () => ctx.selectAsset(sel),
    });
    card.append(el('span', { class: 'ico', text: ICON[it.type] }));
    card.append(el('span', { class: 'nm', text: it.asset.name, title: it.asset.name }));

    const use = el('span', { class: 'use', text: '+', title: USE_TITLE[it.type] });
    use.addEventListener('click', (e) => { e.stopPropagation(); this.use(it); });
    card.append(use);

    const del = button('×', () => {}, 'del');
    del.title = 'Delete asset';
    del.addEventListener('click', (e) => { e.stopPropagation(); ctx.deleteAsset(sel); });
    card.append(del);
    return card;
  }

  private use(it: Item): void {
    if (it.type === 'script') this.ctx.attachScriptAsset(it.asset);
    else if (it.type === 'material') this.ctx.assignMaterialAsset(it.asset);
    else this.ctx.instantiatePrefab(it.asset);
  }

  private updateHighlight(): void {
    const id = this.ctx.selectedAsset?.asset.id;
    for (const child of Array.from(this.grid.children)) {
      const card = child as HTMLElement;
      card.classList.toggle('selected', id !== undefined && card.getAttribute('data-id') === String(id));
    }
  }
}
