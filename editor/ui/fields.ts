/**
 * Inspector field builders. Each returns a {@link Field}: a `.field` row element
 * plus a `refresh()` that re-reads the model into the input (used when selection
 * changes or a gizmo edits the transform). Writes go straight to the `set`
 * callback the caller provides. Styling matches the CSS in `index.html`.
 */
import { el } from './dom';

export interface Field {
  row: HTMLElement;
  refresh(): void;
}

/** A labeled numeric input that commits on input/change. */
export function numberField(
  label: string,
  get: () => number,
  set: (v: number) => void,
  step = 0.1,
): Field {
  const input = el('input', { attrs: { type: 'number', step: String(step) } });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) set(v);
  });
  const row = el('div', { class: 'field' }, [el('label', { text: label }), input]);
  return {
    row,
    refresh: () => { input.value = round(get()); },
  };
}

/** A slider + readout for a 0..1 (or custom range) value. */
export function sliderField(
  label: string,
  get: () => number,
  set: (v: number) => void,
  min = 0,
  max = 1,
  step = 0.01,
): Field {
  const range = el('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step) } });
  const val = el('span', { class: 'val' });
  range.addEventListener('input', () => {
    const v = parseFloat(range.value);
    set(v);
    val.textContent = round(v);
  });
  const wrap = el('div', { class: 'slider' }, [range, val]);
  const row = el('div', { class: 'field' }, [el('label', { text: label }), wrap]);
  return {
    row,
    refresh: () => { const v = get(); range.value = String(v); val.textContent = round(v); },
  };
}

/** A color picker bound to a linear [r,g,b] (sRGB shown in the swatch). */
export function colorField(
  label: string,
  get: () => [number, number, number],
  set: (rgb: [number, number, number]) => void,
): Field {
  const input = el('input', { attrs: { type: 'color' } });
  input.addEventListener('input', () => set(hexToLinear(input.value)));
  const row = el('div', { class: 'field' }, [el('label', { text: label }), input]);
  return {
    row,
    refresh: () => { input.value = linearToHex(get()); },
  };
}

/** A checkbox row. */
export function checkboxField(label: string, get: () => boolean, set: (b: boolean) => void): Field {
  const input = el('input', { attrs: { type: 'checkbox' } });
  input.addEventListener('change', () => set(input.checked));
  const wrap = el('div', { class: 'row-inline' }, [input]);
  const row = el('div', { class: 'field' }, [el('label', { text: label }), wrap]);
  return { row, refresh: () => { input.checked = get(); } };
}

/** A dropdown bound to a string value. */
export function selectField(
  label: string,
  options: string[],
  get: () => string,
  set: (v: string) => void,
): Field {
  const select = el('select');
  for (const o of options) select.append(el('option', { text: o, attrs: { value: o } }));
  select.addEventListener('change', () => set(select.value));
  const row = el('div', { class: 'field' }, [el('label', { text: label }), select]);
  return { row, refresh: () => { select.value = get(); } };
}

/** A free-text input bound to a string value. */
export function textField(label: string, get: () => string, set: (v: string) => void): Field {
  const input = el('input', { attrs: { type: 'text' } });
  input.classList.add('name-input');
  input.addEventListener('input', () => set(input.value));
  const row = el('div', { class: 'field' }, [el('label', { text: label }), input]);
  return { row, refresh: () => { input.value = get(); } };
}

/** Three color-coded numeric inputs editing an [x,y,z] tuple in place. */
export function vec3Field(
  label: string,
  get: () => [number, number, number],
  set: (v: [number, number, number]) => void,
  step = 0.1,
): Field {
  const axes: HTMLInputElement[] = [];
  const cls = ['x', 'y', 'z'];
  const wrap = el('div', { class: 'vec3' });
  for (let i = 0; i < 3; i++) {
    const input = el('input', { attrs: { type: 'number', step: String(step) } });
    input.addEventListener('input', () => {
      const cur = get();
      const v = parseFloat(input.value);
      if (!Number.isNaN(v)) { cur[i] = v; set(cur); }
    });
    axes.push(input);
    wrap.append(el('div', { class: `axis ${cls[i]}`, attrs: { 'data-axis': cls[i].toUpperCase() } }, [input]));
  }
  const row = el('div', { class: 'field' }, [el('label', { text: label }), wrap]);
  return {
    row,
    refresh: () => { const v = get(); for (let i = 0; i < 3; i++) axes[i].value = round(v[i]); },
  };
}

// ---- helpers ----

function round(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

function linearToHex(rgb: [number, number, number]): string {
  const c = (x: number) => {
    const s = Math.pow(Math.max(0, Math.min(1, x)), 1 / 2.2);
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

function hexToLinear(hex: string): [number, number, number] {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const lin = (x: number) => Math.pow(x, 2.2);
  return [lin(r), lin(g), lin(b)];
}
