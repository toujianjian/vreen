// A tiny bridge to pass a freshly-uploaded File from the home page to the
// viewer page without putting binary blobs in Zustand (which doesn't serialize).
//
// Usage:
//   Uploader → uploadBridge.set(file)
//   ViewerPage → const f = uploadBridge.consume()
//
// `consume()` keeps its original first-consumer-wins semantics (it clears the
// bridge). The last handed-off file is ALSO remembered, so a second consumer
// can recover it with `recover()`. Without that, two real flows silently lose
// the asset and the viewer falls back to the placeholder model:
//
//   1. React StrictMode (dev) double-mounts a component's effects: mount #1
//      consumes the file and starts loading, the throwaway cleanup unmounts it,
//      and mount #2 finds an empty bridge. GLB imports hit this hard because
//      CustomStage (unlike the r3f Canvas subtree) really does double-mount,
//      so every GLB showed the placeholder instead of the model.
//   2. Renderer fallback: CustomStage consumes a .glb, fails (parse error,
//      black-screen probe, render throw) and Stage hands off to the three.js
//      path — SceneContents must still get the file rather than the placeholder.

let _file: File | null = null;
/** Last file ever handed off via `set()`/`consume()`, kept after the bridge clears. */
let _last: File | null = null;

export const uploadBridge = {
  set(file: File) {
    _file = file;
    _last = file;
  },
  consume(): File | null {
    const f = _file;
    _file = null;
    if (f) _last = f;
    return f;
  },
  /**
   * Recover a file that `consume()` already drained. Returns it only when the
   * requested id matches the remembered file name (the Uploader sets the asset
   * id to `file.name`), so a stale upload can never leak into a different
   * asset's load.
   */
  recover(id?: string): File | null {
    if (!_last) return null;
    if (id && _last.name !== id) return null;
    return _last;
  },
  /** The file currently waiting to be consumed (not the recovered one). */
  peek(): File | null {
    return _file;
  },
  clear() {
    _file = null;
    _last = null;
  },
};
