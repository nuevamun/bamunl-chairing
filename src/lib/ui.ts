// Tiny DOM builder. Text always goes in as text nodes, never HTML, so a delegate named "<img onerror=…>" is inert.
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;
export function h(tag: string, attrs: Attrs | null, ...kids: Array<Node | string | null | false | undefined>): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
}
export const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;

/** Replace a container's contents, skipping empty slots. (replaceChildren prints null as the word "null".) */
export function mount(el: Element, ...kids: Array<Node | string | null | false | undefined>) {
  el.replaceChildren(...(kids.filter((k) => k != null && k !== false) as Array<Node | string>));
}
