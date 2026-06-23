/** Minimal DOM helpers shared by the editor panels (no framework, no deps). */

export interface ElOpts {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  attrs?: Record<string, string>;
  onclick?: (e: MouseEvent) => void;
}

/** Create an element with optional class/text/attrs/handler and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOpts = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.title) node.title = opts.title;
  if (opts.attrs) for (const k in opts.attrs) node.setAttribute(k, opts.attrs[k]);
  if (opts.onclick) node.addEventListener('click', opts.onclick as EventListener);
  for (const c of children) node.append(c);
  return node;
}

/** Remove all children of a node. */
export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A styled button bound to a click handler. */
export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  return el('button', { text: label, class: className, onclick: () => onClick() });
}
