// The recipe editor (recipe-editor.mjs) on its routes (EDITOR.md):
//   #/new             a blank recipe
//   #/new/<queueId>   a recipe for a queued video (video, title and creator filled in)
//   #/edit/<id>       an existing recipe; the recipe page links here
// plus a "New recipe" button in the home tools. On the static build the editor is read-only by itself
// (<html data-static="1">): it offers "Download JSON" instead of saving, so nothing tries to write.
import { mount as mountEditor } from './recipe-editor.mjs';

export function install(rb) {
  let editor = null;
  let editingId = null;
  const unmount = () => {
    editor?.destroy();
    editor = null;
    editingId = null;
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
      unmount();
      const entry = param ? rb.queue().find((q) => q.id === param) : undefined;
      if (param && !entry) return missing(root, 'That video is no longer in the queue');
      const el = page(root, {
        title: entry ? `Write up: ${entry.title ?? 'a queued video'}` : 'New recipe',
        intro: rb.isStatic ? 'This copy can\'t save: fill in the form and download the recipe file.' : '',
      });
      editor = mountEditor(el, { video: entry, recipes: rb.recipes(), readOnly: rb.isStatic });
    },
  });

  rb.addRoute('edit', {
    title: 'Edit recipe',
    layout: 'detail',
    render(root, param) {
      unmount();
      const recipe = rb.recipe(param);
      if (!recipe) return missing(root, 'There is no recipe with that id');
      editingId = recipe.id;
      const el = page(root, { title: `Edit: ${recipe.title}`, intro: '' });
      editor = mountEditor(el, { recipe, recipes: rb.recipes(), readOnly: rb.isStatic });
    },
  });

  rb.on('view', ({ name }) => {
    if (name !== 'new' && name !== 'edit') unmount();
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
    rb.navigate(id ? `#/r/${encodeURIComponent(id)}` : '#/');
  });
}
