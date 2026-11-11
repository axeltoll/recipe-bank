// The recipe editor (recipe-editor.mjs) on its routes (EDITOR.md):
//   #/new             a blank recipe
//   #/new/<queueId>   a recipe for a queued video (video, title and creator filled in)
//   #/edit/<id>       an existing recipe; the recipe page links here
// plus a "New recipe" button in the home tools. On the static build the editor is read-only by itself
// (<html data-static="1">): it offers "Download JSON" instead of saving, so nothing tries to write.
//
// Unsaved changes: closing or reloading the tab asks through `beforeunload`. Any other way out of the editor
// (header links, the back button, a typed hash) asks "Leave without saving?" once the route has changed. The
// dashboard has already drawn the next view by then, so "Cancel" goes back to the editor's hash and puts the
// same editor (its form, draft and undo) back on the page instead of starting a new one.
import { mount as realMountEditor } from './recipe-editor.mjs';

const LEAVE = 'Leave without saving? Your changes to this recipe will be lost.';
const currentHash = () => globalThis.location?.hash ?? '';

// `mountEditor` is only replaced by the tests (there is no DOM in node:test).
export function install(rb, { mountEditor = realMountEditor } = {}) {
  let editor = null;
  let editingId = null;
  let editorHash = null; // the hash the editor was opened on
  let editorPage = null; // its page, kept so a "Cancel" on leaving can put it back
  const unmount = () => {
    editor?.destroy();
    editor = null;
    editingId = null;
    editorHash = null;
    editorPage = null;
  };
  const opened = (root, instance) => {
    editor = instance;
    editorHash = currentHash();
    editorPage = root.firstElementChild ?? null;
  };

  /**
   * The route is moving away from the editor. Returns true when it may go (no changes, or the reader agreed to
   * drop them); otherwise keeps the editor and goes back to its hash.
   */
  const leave = () => {
    if (!editor) return true;
    if (!editor.isDirty() || confirm(LEAVE)) {
      unmount();
      return true;
    }
    rb.navigate(editorHash);
    return false;
  };

  /** Back on the editor's own hash with unsaved changes (after "Cancel", or a re-render): show the same editor. */
  const restore = (root) => {
    if (!editor || !editorPage || currentHash() !== editorHash || !editor.isDirty()) return false;
    root.replaceChildren(editorPage);
    return true;
  };
  const enter = (root) => {
    if (restore(root)) return false;
    if (editor && currentHash() !== editorHash && !leave()) return false;
    unmount();
    return true;
  };

  const page = (root, { title, intro }) => {
    root.innerHTML = `
      <div class="feature-page">
        <header class="feature-head">
          <a class="back" href="${editingId ? `#/r/${rb.esc(encodeURIComponent(editingId))}` : '#/'}">${rb.icon('back')}<span>${editingId ? 'Back to the recipe' : 'All recipes'}</span></a>
          <h1>${rb.esc(title)}</h1>
          ${intro ? `<p>${intro}</p>` : ''}
        </header>
        <div data-part="editor"></div>
      </div>`;
    return root.querySelector('[data-part="editor"]');
  };

  const missing = (root, text) => {
    root.innerHTML = `
      <div class="state">
        ${rb.icon('alert')}
        <h2>${rb.esc(text)}</h2>
        <div class="state-actions"><a class="btn btn-primary" href="#/">All recipes</a></div>
      </div>`;
  };

  rb.addRoute('new', {
    title: 'New recipe',
    layout: 'detail',
    render(root, param) {
      if (!enter(root)) return;
      const entry = param ? rb.queue().find((q) => q.id === param) : undefined;
      if (param && !entry) return missing(root, 'That video is no longer in the queue');
      const el = page(root, {
        title: entry ? `Write up: ${entry.title ?? 'a queued video'}` : 'New recipe',
        intro: rb.isStatic ? 'This copy can\'t save: fill in the form and download the recipe file.' : '',
      });
      opened(root, mountEditor(el, { video: entry, recipes: rb.recipes(), readOnly: rb.isStatic }));
    },
  });

  rb.addRoute('edit', {
    title: 'Edit recipe',
    layout: 'detail',
    render(root, param) {
      if (!enter(root)) return;
      const recipe = rb.recipe(param);
      if (!recipe) return missing(root, 'There is no recipe with that id');
      editingId = recipe.id;
      const el = page(root, { title: `Edit: ${recipe.title}`, intro: '' });
      opened(root, mountEditor(el, { recipe, recipes: rb.recipes(), readOnly: rb.isStatic }));
    },
  });

  rb.on('view', ({ name }) => {
    if (name !== 'new' && name !== 'edit') leave();
    if (name === 'home') {
      rb.mount('home-tools')?.insertAdjacentHTML('beforeend',
        `<a class="btn" href="#/new">${rb.icon('plus')}<span>New recipe</span></a>`);
    }
  });

  // A saved recipe: re-read the bank (the server may also have removed its queue entry), then show it.
  document.addEventListener('recipe-bank:recipe-saved', async (e) => {
    const { id, created } = e.detail ?? {};
    try {
      await rb.reload();
    } catch {
      rb.toast('Saved, but the list could not be reloaded');
      return;
    }
    rb.toast(created ? 'Recipe saved' : 'Changes saved');
    if (id) rb.navigate(`#/r/${encodeURIComponent(id)}`);
  });

  document.addEventListener('recipe-bank:editor-cancel', (e) => {
    const { id, dirty } = e.detail ?? {};
    if (dirty && !confirm('Discard your changes?')) return;
    unmount(); // already confirmed: leaving must not ask again
    rb.navigate(id ? `#/r/${encodeURIComponent(id)}` : '#/');
  });

  // Closing or reloading the tab with unsaved changes: the browser asks.
  globalThis.addEventListener?.('beforeunload', (e) => {
    if (!editor?.isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}
