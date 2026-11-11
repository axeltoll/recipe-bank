// Feature registry. The dashboard imports this file at boot and installs each feature in order.
//
// A feature is a self-contained ES module in this folder that exports `install(rb)`. It fills mount points,
// registers filters and routes through `rb`, and never edits app.js or the views in ui/.
// The contract (mount ids, events, the rb API) is docs/design/MOUNT-POINTS.md.
//
// To add one, append a loader. Loaders are functions, so a feature that fails to load is skipped and
// reported in the console while the rest of the dashboard keeps working:
//
//   export const features = [
//     () => import('./week-plan.js'),
//     () => import('./shopping-list.js'),
//   ];
//
// If the service worker should keep a feature available offline, add its path to SHELL in /sw.js as well.

export const features = [];
