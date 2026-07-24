// Scripting barrel.

export {
  ScriptComponent,
  ScriptC,
  SCRIPT_COMPONENT_NAME,
  type ScriptContext,
  type ScriptInstance,
} from './ScriptComponent';
export {
  ScriptSystem,
  type CollisionDispatch,
  type TriggerDispatch,
} from './ScriptSystem';
export {
  ScriptRegistry,
  scriptRegistry,
  type ScriptFactory,
} from './ScriptRegistry';
export {
  CoroutineSystem,
  type CoroutineHandle,
  type CoroutineYield,
} from './Coroutine';
export { type CollisionInfo, type TriggerInfo } from './ScriptSystem';
