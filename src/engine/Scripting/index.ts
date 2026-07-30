// Scripting barrel.

export {
  ScriptComponent,
  ScriptC,
  SCRIPT_COMPONENT_NAME,
  type ScriptContext,
  type ScriptInstance,
  // Visual Scripting — Script Canvas 风格可视化脚本组件 (参考 o3de Gems/ScriptCanvas)。
  VisualScriptComponent,
  type ScriptNode,
  type ScriptNodeType,
  type ScriptPin,
  type ScriptPinConnection,
  type ScriptGraphJSON,
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
