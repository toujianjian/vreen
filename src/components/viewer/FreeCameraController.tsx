import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useViewerStore } from '@/stores/viewerStore';
import { useTranslation } from 'react-i18next';

interface KeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  q: boolean;
  e: boolean;
  shift: boolean;
}

export function FreeCameraController() {
  const { camera } = useThree();
  const cam = useViewerStore((s) => s.camera);
  const { t } = useTranslation();

  const keys = useRef<KeyState>({
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    e: false,
    shift: false,
  });

  const velocity = useRef(new THREE.Vector3());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keys.current.w = true;
      if (key === 'a' || key === 'arrowleft') keys.current.a = true;
      if (key === 's' || key === 'arrowdown') keys.current.s = true;
      if (key === 'd' || key === 'arrowright') keys.current.d = true;
      if (key === 'q') keys.current.q = true;
      if (key === 'e') keys.current.e = true;
      if (e.shiftKey) keys.current.shift = true;

      const shouldCapture = keys.current.w || keys.current.a || keys.current.s || keys.current.d || keys.current.q || keys.current.e;
      if (shouldCapture && e.target instanceof HTMLCanvasElement) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keys.current.w = false;
      if (key === 'a' || key === 'arrowleft') keys.current.a = false;
      if (key === 's' || key === 'arrowdown') keys.current.s = false;
      if (key === 'd' || key === 'arrowright') keys.current.d = false;
      if (key === 'q') keys.current.q = false;
      if (key === 'e') keys.current.e = false;
      if (!e.shiftKey) keys.current.shift = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame((_, delta) => {
    const isFreeMode = cam.preset === 'free' || cam.preset === 'first-person';
    if (!isFreeMode) return;

    const k = keys.current;
    const anyKey = k.w || k.a || k.s || k.d || k.q || k.e;
    if (!anyKey) return;

    const speed = k.shift ? 6.0 : 2.0;
    const moveSpeed = speed * delta;

    const direction = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();

    right.crossVectors(direction, up).normalize();

    velocity.current.set(0, 0, 0);

    if (k.w) velocity.current.add(direction);
    if (k.s) velocity.current.sub(direction);
    if (k.a) velocity.current.sub(right);
    if (k.d) velocity.current.add(right);
    if (k.q) velocity.current.y -= 1;
    if (k.e) velocity.current.y += 1;

    velocity.current.normalize().multiplyScalar(moveSpeed);
    camera.position.add(velocity.current);
  });

  const isFreeMode = cam.preset === 'free' || cam.preset === 'first-person';
  const anyKeyPressed = keys.current.w || keys.current.a || keys.current.s || keys.current.d || keys.current.q || keys.current.e;

  return (
    <>
      {isFreeMode && anyKeyPressed && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="px-4 py-2 bg-space-900/80 backdrop-blur-sm border border-neon-cyan/20 rounded-lg">
            <div className="font-mono text-[11px] tracking-wider text-neon-cyan">
              {t('viewer.freeCamera.hint')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}