// Just enough of a browser for public/ui modules, which import /lib/ by absolute URL.
// node:test has no DOM and no import map, so a test installs the resolver, then the stand-ins, then imports.

import { registerHooks } from 'node:module';

let resolverInstalled = false;

/** Resolve `/lib/…` and absolute `/…` imports from public/ the way the dashboard server does. */
export function installUiResolver() {
  if (resolverInstalled) return;
  resolverInstalled = true;
  const root = new URL('../../', import.meta.url);
  const publicRoot = new URL('public/', root);
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('/lib/')) return next(new URL(specifier.slice(1), root).href, context);
      if (specifier.startsWith('/') && context.parentURL?.includes('/public/')) {
        return next(new URL(`.${specifier}`, publicRoot).href, context);
      }
      return next(specifier, context);
    },
  });
}

/**
 * Stand-ins for the globals public/ui reads at import time, plus one element per id.
 * Setting an element's innerHTML registers any `id="…"` it contains, so a view can find the
 * buttons it just rendered.
 */
export function installBrowser(ids) {
  const nodes = new Map();

  function make(id) {
    const listeners = {};
    const attrs = {};
    const node = {
      id,
      dataset: {},
      className: '',
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      open: false,
      isConnected: true,
      textContent: '',
      listeners,
      classList: {
        add() {},
        remove() {},
        toggle() {},
      },
      setAttribute(name, value) { attrs[name] = String(value); },
      getAttribute(name) { return Object.hasOwn(attrs, name) ? attrs[name] : null; },
      removeAttribute(name) { delete attrs[name]; },
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
      dispatchEvent(event) {
        for (const fn of listeners[event.type] ?? []) fn(event);
        return true;
      },
      focus() {},
      reset() {},
      showModal() { node.open = true; },
      close() {
        if (!node.open) return;
        node.open = false;
        node.dispatchEvent({ type: 'close' });
      },
    };
    let html = '';
    Object.defineProperty(node, 'innerHTML', {
      get() { return html; },
      set(value) {
        html = String(value ?? '');
        for (const match of html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) {
          if (match[1] === id) continue;
          nodes.delete(match[1]);
          make(match[1]);
        }
      },
    });
    nodes.set(id, node);
    return node;
  }

  for (const id of ids) make(id);

  const document = {
    documentElement: { dataset: {} },
    title: '',
    head: { append() {} },
    body: { append() {} },
    visibilityState: 'visible',
    querySelector(sel) {
      const id = /^#([A-Za-z0-9_-]+)$/.exec(sel)?.[1];
      return id ? nodes.get(id) ?? null : null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ dataset: {} }),
    getElementById: (id) => nodes.get(id) ?? null,
  };

  globalThis.document = document;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.location = { hash: '' };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { async writeText() {} } },
  });
  return { document, get: (id) => nodes.get(id) };
}
