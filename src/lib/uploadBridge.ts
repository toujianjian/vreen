// A tiny bridge to pass a freshly-uploaded File from the home page to the
// viewer page without putting binary blobs in Zustand (which doesn't serialize).
//
// Usage:
//   Uploader → uploadBridge.set(file)
//   ViewerPage → const f = uploadBridge.consume()

let _file: File | null = null;

export const uploadBridge = {
  set(file: File) {
    _file = file;
  },
  consume(): File | null {
    const f = _file;
    _file = null;
    return f;
  },
  peek(): File | null {
    return _file;
  },
  clear() {
    _file = null;
  },
};
