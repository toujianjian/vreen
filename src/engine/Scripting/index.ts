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
export {
  ScriptBindings,
  getDefaultScriptBindings,
  resetDefaultScriptBindings,
  type ScriptBinding,
  type ScriptBindingType,
  type ScriptAPIInfo,
  type ScriptAPIDocCategory,
  type ScriptAPIDocumentation,
  type ScriptBindingsStats,
} from './ScriptBindings';
export { type CollisionInfo, type TriggerInfo } from './ScriptSystem';
