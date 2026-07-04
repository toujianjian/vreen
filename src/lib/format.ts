// Lightweight format detection utilities

import type { ModelFormat } from '@/types';

export const FORMAT_EXTENSIONS: Record<string, ModelFormat> = {
  glb: 'glb',
  gltf: 'gltf',
  obj: 'obj',
  fbx: 'fbx',
  stl: 'stl',
  ply: 'ply',
};

export const FORMAT_LABEL: Record<ModelFormat, string> = {
  glb: 'GLB',
  gltf: 'GLTF',
  obj: 'OBJ',
  fbx: 'FBX',
  stl: 'STL',
  ply: 'PLY',
};

export const ALL_FORMATS: ModelFormat[] = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'];

export function detectFormat(filename: string): ModelFormat | null {
  const ext = filename.toLowerCase().split('.').pop();
  if (!ext) return null;
  return FORMAT_EXTENSIONS[ext] ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatUtc(d: Date): string {
  return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}
