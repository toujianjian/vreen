// VREEN Electron preload typings — see electron/preload.cjs
export {};

export interface VreenAsset {
  filePath: string;
  name: string;
  size: number;
}

export interface VreenAppInfo {
  version: string;
  name: string;
  platform: NodeJS.Platform | string;
  electron: string;
  chrome: string;
  node: string;
}

export interface VreenAPI {
  openAsset: () => Promise<VreenAsset | null>;
  appInfo: () => Promise<VreenAppInfo>;
  quit: () => Promise<void>;
  isElectron: boolean;
}

declare global {
  interface Window {
    vreenAPI?: VreenAPI;
    __VREEN_RUNTIME__?: {
      electron?: boolean;
      version?: string;
      platform?: string;
    };
  }
}
