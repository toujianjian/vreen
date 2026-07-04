/// <reference types="vite/client" />

// Local ambient declarations for build-time Node imports.
declare module 'node:url' {
  export interface URL_ {
    href: string;
    pathname: string;
    toString(): string;
  }
  export interface URL_Constructor {
    new (input: string, base?: string | URL_Constructor): URL_;
  }
  export const URL: URL_Constructor;
  export function fileURLToPath(url: URL_ | string): string;
}
