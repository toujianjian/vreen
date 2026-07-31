// PassGraph barrel — composable hierarchical render pass system.
// Coexists with the flat PostProcessingPipeline (Renderer/RenderPass.ts);
// opt-in for render-to-texture subgraphs, multi-viewport, cube-map pre-bake,
// or user-insertable passes.

export * from './PassAttachment';
export * from './Pass';
export * from './PassTemplate';
export * from './PassFactory';
export * from './PassGraph';
