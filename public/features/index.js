// Feature registry. The dashboard imports this file at boot and installs each feature in order.
//
// A feature is a self-contained ES module in this folder that exports `install(rb)`. It fills mount points,
// registers filters and routes through `rb`, and never edits app.js or the views in ui/.
// The contract (mount ids, events, the rb API) is docs/design/MOUNT-POINTS.md.
//
// Loaders are functions, so a feature that fails to load is skipped and reported in the console while the rest
// of the dashboard keeps working. The order is the order of the header navigation and of the buttons features
// add to a shared mount point.
//
// Every module these load (and the stylesheets they add) is precached in SHELL in /sw.js; test/sw.test.mjs
// follows these imports and fails when one is missing.

export const features = [
  () => import('./filters-feature.js'), //   Without, tags, nutrition in the filter panel
  () => import('./scale-feature.js'), //     serving scaling on the recipe page
  () => import('./plan-feature.js'), //      #/plan: week plan and shopping list; "Add to week"
  () => import('./household-feature.js'), // #/household: household profile and food budget
  () => import('./packs-feature.js'), //     #/packs: share and import recipe packs
  () => import('./editor-feature.js'), //    #/new, #/new/<queueId>, #/edit/<id>: the recipe editor
];
