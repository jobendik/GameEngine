import { MathUtils } from '@/core/math';
import { LightType } from '@/render';
import { BodyType } from '@/physics';
import type { EditorContext } from '@editor/core';
import type { EditorObject } from '@editor/core';
import type { LightKind, BodyKind, ScriptData } from '@editor/core';
import { BUILTIN_BEHAVIORS, getBehaviorDef } from '@editor/script';
import type { ParamSpec } from '@editor/script';
import { el, clear, button } from '@editor/ui/dom';
import {
  numberField, sliderField, colorField, checkboxField, selectField, textField, vec3Field,
} from '@editor/ui/fields';
import type { Field } from '@editor/ui/fields';

type ParamBag = Record<string, number | boolean | string | number[]>;

/**
 * The right-hand Inspector. When an object is selected it shows the relevant
 * editable groups (Object / Transform / Material / Light / Physics); with no
 * selection it edits the scene environment. Every write goes straight to the
 * live engine component, then through the matching `ctx.notify*` so the rest of
 * the editor updates. Field values are refreshed in place on the lightweight
 * change events ('transform' / 'props' / 'environment') without rebuilding.
 */
export class InspectorPanel {
  private readonly ctx: EditorContext;
  private readonly body: HTMLElement;
  /** Active fields, refreshed when a change event fires. */
  private fields: Field[] = [];

  constructor(ctx: EditorContext) {
    this.ctx = ctx;
    const root = document.getElementById('inspector');
    if (!root) throw new Error('InspectorPanel: #inspector element not found');

    this.body = el('div', { class: 'insp-body' });
    root.append(this.body);

    const events = ctx.events;
    // Structural changes rebuild the whole body.
    events.on('selection', () => this.rebuild());
    events.on('hierarchy', () => this.rebuild());
    events.on('mode', () => this.rebuild());
    // Value-only changes just re-read the model into the existing inputs.
    events.on('transform', () => this.refresh());
    events.on('props', () => this.refresh());
    events.on('environment', () => this.refresh());

    this.rebuild();
  }

  // ---------------------------------------------------------------------------

  /** Re-read every active field's model value into its input. */
  private refresh(): void {
    for (const f of this.fields) f.refresh();
  }

  /** Tear down and rebuild the inspector body for the current selection. */
  private rebuild(): void {
    clear(this.body);
    this.fields = [];
    const sel = this.ctx.selection;
    if (sel) this.buildForObject(sel);
    else this.buildForEnvironment();
    this.refresh();
  }

  // ---------------------------------------------------------------------------
  // Object inspector
  // ---------------------------------------------------------------------------

  private buildForObject(obj: EditorObject): void {
    this.buildObjectGroup(obj);
    this.buildTransformGroup(obj);
    if (obj.material) this.buildMaterialGroup(obj);
    if (obj.light) this.buildLightGroup(obj);
    this.buildPhysicsGroup(obj);
    this.buildScriptsGroup(obj);
  }

  private buildObjectGroup(obj: EditorObject): void {
    const ctx = this.ctx;
    this.group('Object', [
      this.add(textField('Name', () => obj.name, (v) => ctx.rename(obj, v))),
    ]);
  }

  private buildTransformGroup(obj: EditorObject): void {
    const ctx = this.ctx;
    const t = obj.transform;
    this.group('Transform', [
      this.add(vec3Field('Position',
        () => [t.position.x, t.position.y, t.position.z],
        (v) => { t.position.set(v[0], v[1], v[2]); ctx.notifyTransform(obj); })),
      this.add(vec3Field('Rotation',
        () => [obj.rotationEuler[0], obj.rotationEuler[1], obj.rotationEuler[2]],
        (v) => { obj.rotationEuler = [v[0], v[1], v[2]]; ctx.notifyTransform(obj); }, 1)),
      this.add(vec3Field('Scale',
        () => [t.scale.x, t.scale.y, t.scale.z],
        (v) => { t.scale.set(v[0], v[1], v[2]); ctx.notifyTransform(obj); })),
    ]);
  }

  private buildMaterialGroup(obj: EditorObject): void {
    const ctx = this.ctx;
    const m = obj.material!;
    this.group('Material', [
      this.add(colorField('Albedo',
        () => [m.albedo.r, m.albedo.g, m.albedo.b],
        (c) => { m.albedo.set(c[0], c[1], c[2], 1); ctx.notifyProps(obj); })),
      this.add(sliderField('Metallic', () => m.metallic,
        (v) => { m.metallic = v; ctx.notifyProps(obj); })),
      this.add(sliderField('Roughness', () => m.roughness,
        (v) => { m.roughness = v; ctx.notifyProps(obj); })),
      this.add(colorField('Emissive',
        () => [m.emissive.r, m.emissive.g, m.emissive.b],
        (c) => { m.emissive.set(c[0], c[1], c[2], 1); ctx.notifyProps(obj); })),
      this.add(numberField('Emissive Int', () => m.emissiveIntensity,
        (v) => { m.emissiveIntensity = Math.max(0, v); ctx.notifyProps(obj); })),
      this.add(sliderField('Opacity', () => m.opacity,
        (v) => { m.opacity = v; m.transparent = v < 1; ctx.notifyProps(obj); })),
    ]);
  }

  private buildLightGroup(obj: EditorObject): void {
    const ctx = this.ctx;
    const light = obj.light!;
    const fields: Field[] = [
      this.add(selectField('Type', ['directional', 'point', 'spot'],
        () => lightKindOf(light.type),
        (v) => { obj.setLightKind(v as LightKind); ctx.notifyProps(obj); this.rebuild(); })),
      this.add(colorField('Color',
        () => [light.color.r, light.color.g, light.color.b],
        (c) => { light.color.set(c[0], c[1], c[2], 1); ctx.notifyProps(obj); })),
      this.add(numberField('Intensity', () => light.intensity,
        (v) => { light.intensity = Math.max(0, v); ctx.notifyProps(obj); })),
      this.add(numberField('Range', () => light.range,
        (v) => { light.range = Math.max(0, v); ctx.notifyProps(obj); })),
    ];
    if (light.type === LightType.Spot) {
      fields.push(
        this.add(numberField('Inner Cone', () => light.innerCone * MathUtils.RAD2DEG,
          (v) => { light.innerCone = v * MathUtils.DEG2RAD; ctx.notifyProps(obj); }, 1)),
        this.add(numberField('Outer Cone', () => light.outerCone * MathUtils.RAD2DEG,
          (v) => { light.outerCone = v * MathUtils.DEG2RAD; ctx.notifyProps(obj); }, 1)),
      );
    }
    fields.push(
      this.add(checkboxField('Cast Shadow', () => light.castShadow,
        (b) => { light.castShadow = b; ctx.notifyProps(obj); })),
    );
    this.group('Light', fields);
  }

  private buildPhysicsGroup(obj: EditorObject): void {
    const ctx = this.ctx;
    const fields: Field[] = [
      this.add(checkboxField('Rigid Body', () => !!obj.body, (b) => {
        if (b) obj.enableBody('dynamic');
        else obj.disableBody();
        ctx.notifyProps(obj);
        this.rebuild();
      })),
    ];
    const body = obj.body;
    if (body) {
      fields.push(
        this.add(selectField('Body', ['dynamic', 'static'],
          () => bodyKindOf(body.type),
          (v) => { obj.setBodyKind(v as BodyKind); ctx.notifyProps(obj); this.rebuild(); })),
        this.add(numberField('Mass', () => body.mass,
          (v) => { body.mass = Math.max(0, v); ctx.notifyProps(obj); })),
        this.add(sliderField('Restitution', () => body.restitution,
          (v) => { body.restitution = v; ctx.notifyProps(obj); })),
        this.add(sliderField('Friction', () => body.friction,
          (v) => { body.friction = v; ctx.notifyProps(obj); })),
      );
    }
    this.group('Physics', fields);
  }

  // ---------------------------------------------------------------------------
  // Scripts / behaviors
  // ---------------------------------------------------------------------------

  private buildScriptsGroup(obj: EditorObject): void {
    const body = el('div', { class: 'group-body' });

    obj.scripts.forEach((sd, idx) => body.append(this.buildScriptBlock(obj, sd, idx)));

    // "Add Script" dropdown: built-in behaviors + Custom Code.
    const select = el('select') as HTMLSelectElement;
    select.append(el('option', { text: '+ Add behavior…', attrs: { value: '' } }));
    for (const def of BUILTIN_BEHAVIORS) {
      select.append(el('option', { text: def.label, attrs: { value: def.type } }));
    }
    select.append(el('option', { text: 'Custom Code', attrs: { value: 'custom' } }));
    select.addEventListener('change', () => {
      const type = select.value;
      if (!type) return;
      const sd: ScriptData = type === 'custom'
        ? { type: 'custom', code: CUSTOM_TEMPLATE }
        : { type, params: {} };
      obj.scripts.push(sd);
      this.rebuild();
    });
    body.append(el('div', { class: 'field' }, [el('label', { text: 'Add' }), select]));

    const head = el('div', { class: 'group-head', text: 'Scripts' });
    this.body.append(el('div', { class: 'group' }, [head, body]));
  }

  /** One attached script: a header (label + remove) and its params or code. */
  private buildScriptBlock(obj: EditorObject, sd: ScriptData, idx: number): HTMLElement {
    const def = sd.type === 'custom' ? null : getBehaviorDef(sd.type);
    const title = sd.type === 'custom' ? 'Custom Code' : def?.label ?? sd.type;

    const remove = button('×', () => { obj.scripts.splice(idx, 1); this.rebuild(); }, 'del');
    remove.title = 'Remove script';
    const header = el('div', { class: 'script-head' }, [el('span', { text: title }), remove]);

    const block = el('div', { class: 'script-block' }, [header]);

    if (sd.type === 'custom') {
      const ta = el('textarea', {
        attrs: {
          rows: '7', spellcheck: 'false',
          style: 'width:100%;background:#1a1c22;color:#c7cedb;border:1px solid #424857;'
            + 'border-radius:4px;padding:6px;font-family:ui-monospace,monospace;font-size:11px;resize:vertical;',
        },
      }) as HTMLTextAreaElement;
      ta.value = sd.code ?? '';
      ta.addEventListener('input', () => { sd.code = ta.value; });
      block.append(ta);
    } else if (def) {
      const params: ParamBag = (sd.params ??= {});
      if (def.description) {
        block.append(el('div', { class: 'script-desc', text: def.description }));
      }
      for (const spec of def.params) {
        const f = this.add(this.paramField(spec, params));
        block.append(f.row);
      }
    }
    return block;
  }

  /** Build the right inspector field for a behavior parameter spec. */
  private paramField(spec: ParamSpec, params: ParamBag): Field {
    const get = (): number | boolean | string | number[] =>
      params[spec.key] !== undefined ? params[spec.key] : spec.default;
    switch (spec.type) {
      case 'number':
        return numberField(spec.label, () => numOf(get(), spec.default as number),
          (v) => { params[spec.key] = v; }, spec.step ?? 0.1);
      case 'boolean':
        return checkboxField(spec.label, () => Boolean(get()), (v) => { params[spec.key] = v; });
      case 'string':
      case 'key':
        return textField(spec.label, () => String(get()), (v) => { params[spec.key] = v; });
      case 'vec3':
        return vec3Field(spec.label, () => vecOf(get(), spec.default as number[]),
          (v) => { params[spec.key] = v; });
      case 'color':
        return colorField(spec.label, () => vecOf(get(), spec.default as number[]),
          (v) => { params[spec.key] = v; });
    }
  }

  // ---------------------------------------------------------------------------
  // Environment inspector (no selection)
  // ---------------------------------------------------------------------------

  private buildForEnvironment(): void {
    const ctx = this.ctx;
    const env = ctx.scene.environment;
    const notify = () => ctx.notifyEnvironment();
    // Helpers reading/writing the length-3 number[] arrays in place.
    const getRgb = (a: number[]): [number, number, number] => [a[0], a[1], a[2]];
    const setRgb = (a: number[], c: [number, number, number]): void => { a[0] = c[0]; a[1] = c[1]; a[2] = c[2]; };

    this.group('Scene', [
      this.add(colorField('Ambient', () => getRgb(env.ambient),
        (c) => { setRgb(env.ambient, c); notify(); })),
      this.add(colorField('Sun Color', () => getRgb(env.sunColor),
        (c) => { setRgb(env.sunColor, c); notify(); })),
      this.add(vec3Field('Sun Dir', () => getRgb(env.sunDirection),
        (v) => { setRgb(env.sunDirection, v); notify(); })),
      this.add(numberField('Sun Intensity', () => env.sunIntensity,
        (v) => { env.sunIntensity = Math.max(0, v); notify(); })),
      this.add(checkboxField('Sun Shadows', () => env.sunCastShadow,
        (b) => { env.sunCastShadow = b; notify(); })),
      this.add(colorField('Fog Color', () => getRgb(env.fogColor),
        (c) => { setRgb(env.fogColor, c); notify(); })),
      this.add(numberField('Fog Density', () => env.fogDensity,
        (v) => { env.fogDensity = Math.max(0, v); notify(); }, 0.005)),
      this.add(numberField('Exposure', () => env.exposure,
        (v) => { env.exposure = Math.max(0, v); notify(); })),
      this.add(checkboxField('Bloom', () => env.bloom,
        (b) => { env.bloom = b; notify(); })),
      this.add(sliderField('Bloom Strength', () => env.bloomStrength,
        (v) => { env.bloomStrength = v; notify(); }, 0, 2)),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Building blocks
  // ---------------------------------------------------------------------------

  /** Track a field for refresh and return it (so it can be inlined in arrays). */
  private add(field: Field): Field {
    this.fields.push(field);
    return field;
  }

  /** Append a `.group` with a head + body containing the given field rows. */
  private group(title: string, fields: Field[]): void {
    const head = el('div', { class: 'group-head', text: title });
    const groupBody = el('div', { class: 'group-body' }, fields.map((f) => f.row));
    this.body.append(el('div', { class: 'group' }, [head, groupBody]));
  }
}

// ---------------------------------------------------------------------------
// enum <-> string helpers (kept local; the model speaks strings)
// ---------------------------------------------------------------------------

function lightKindOf(type: LightType): LightKind {
  return type === LightType.Directional ? 'directional' : type === LightType.Point ? 'point' : 'spot';
}

function bodyKindOf(type: BodyType): BodyKind {
  return type === BodyType.Static ? 'static' : 'dynamic';
}

function numOf(v: number | boolean | string | number[], d: number): number {
  return typeof v === 'number' ? v : d;
}

function vecOf(v: number | boolean | string | number[], d: number[]): [number, number, number] {
  return Array.isArray(v) ? [v[0], v[1], v[2]] : [d[0], d[1], d[2]];
}

const CUSTOM_TEMPLATE =
  `// Runs every frame in play mode. In scope:\n` +
  `//   dt, time, input, transform, body, object, state, scene, camera,\n` +
  `//   Vec3, Quat, MathUtils\n` +
  `// Example:\n` +
  `transform.position.y = 1 + Math.sin(time.elapsed * 3) * 0.5;\n`;
