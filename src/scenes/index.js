// -----------------------------------------------------------------------------
// Scene surface of the integration: what a scene can REACT to, and what it can
// ASK for.
//
// Both halves are declared in the manifest (`scene_triggers` and
// `scene_actions`) and wired in `index.js` by key, exactly like the manifest
// actions. A test ties the two sides together, because the failure mode is
// silent: a declared key with no handler is a card in the scene editor that
// does nothing, and a handler with no declaration is code nobody can reach.
//
// Keys are FOREVER: a scene stores the key it was built with, so renaming one
// is removing it for every scene already using it.
// -----------------------------------------------------------------------------

export { SCENE_ACTION_HANDLERS, OVERALL_TAXON } from './sceneActions.js';
export {
  publishRiskEvents,
  resetRiskMemory,
  riskTransitions,
  SCENE_TRIGGERS,
} from './riskEvents.js';
