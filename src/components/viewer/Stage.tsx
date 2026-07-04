// 3D stage: the main scene renderer in the inspector.
// Includes ground, lights, post-processing, OrbitControls, and the
// VREEN camera rig (multi-preset, fully user-tunable).
import { Canvas, useFrame } from '@react-three/fiber';
import {
  ContactShadows,
  Environment,
  Grid,
  OrbitControls,
  PerspectiveCamera,
} from '@react-three/drei';
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Vignette,
  SMAA,
} from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';
import { Suspense, useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useUIStore } from '@/stores/uiStore';
import { useViewerStore } from '@/stores/viewerStore';
import { SceneContents } from './SceneContents';
import { SafeEnvironment } from '@/components/three/SafeEnvironment';
import type { EnvironmentPreset } from '@/types';
import {
  CAMERA_PRESETS,
  animateCameraToPreset,
} from '@/three/camera';

export function Stage() {
  const environment = useUIStore((s) => s.environment);
  const postFX = useUIStore((s) => s.postFX);
  const showGround = useViewerStore((s) => s.showGround);
  const camera = useViewerStore((s) => s.camera);

  return (
    <div className="relative w-full h-full">
      {/* Background gradient fallback (drei Environment handles it; this is for resilience) */}
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true, // needed for screenshots
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = environment.exposure;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          scene.background = new THREE.Color(environment.backgroundColor);
        }}
      >
        <SceneEnvironment />
        <Suspense fallback={null}>
          <SceneContents />
          <SafeEnvironment
            preset={environment.preset}
            environmentIntensity={environment.exposure * 0.9}
            background={environment.background === 'envmap' ? 'only' : false}
          />
        </Suspense>

        {showGround && (
          <>
            <ContactShadows
              position={[0, 0, 0]}
              opacity={0.55}
              scale={10}
              blur={2.4}
              far={2.5}
              resolution={1024}
              color="#000000"
            />
            <Grid
              args={[20, 20]}
              cellSize={0.4}
              cellThickness={0.5}
              cellColor="#1a3a4a"
              sectionSize={2}
              sectionThickness={1}
              sectionColor="#00f0ff"
              fadeDistance={18}
              fadeStrength={1.4}
              infiniteGrid
              position={[0, 0.001, 0]}
            />
          </>
        )}

        <CameraRig />
        <CinematicOrbiter />

        <OrbitControls
          makeDefault
          enabled={camera.orbitEnabled && camera.preset !== 'cinematic'}
          enableDamping
          dampingFactor={camera.damping}
          minDistance={1.5}
          maxDistance={20}
          minPolarAngle={CAMERA_PRESETS[camera.preset].minPolarAngle ?? 0.05}
          maxPolarAngle={CAMERA_PRESETS[camera.preset].maxPolarAngle ?? Math.PI / 2 - 0.05}
          target={[0, camera.targetHeight, 0]}
        />

        {postFX.bloom || postFX.chromaticAberration || postFX.vignette ? (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <>
              {postFX.bloom ? (
                <Bloom
                  intensity={postFX.bloomIntensity}
                  luminanceThreshold={0.78}
                  luminanceSmoothing={0.2}
                  kernelSize={KernelSize.LARGE}
                  mipmapBlur
                />
              ) : null}
              {postFX.chromaticAberration ? (
                <ChromaticAberration
                  blendFunction={BlendFunction.NORMAL}
                  offset={new THREE.Vector2(0.0009, 0.0009)}
                  radialModulation={false}
                  modulationOffset={0}
                />
              ) : null}
              <SMAA />
              {postFX.vignette ? <Vignette eskil={false} offset={0.18} darkness={0.65} /> : null}
            </>
          </EffectComposer>
        ) : (
          <EffectComposer multisampling={0}>
            <SMAA />
          </EffectComposer>
        )}
      </Canvas>

      {/* Subtle scanline overlay for cyberpunk feel */}
      <div className="pointer-events-none absolute inset-0 bg-scanlines opacity-30 mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(5,7,13,0.55)_100%)]" />
    </div>
  );
}

function SceneEnvironment() {
  const { scene } = useThree();
  const environment = useUIStore((s) => s.environment);
  useEffect(() => {
    scene.background = new THREE.Color(environment.backgroundColor);
  }, [scene, environment.backgroundColor]);
  return (
    <>
      <ambientLight intensity={0.18} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-4, 3, -2]} intensity={0.45} color="#ff2bd6" />
      <directionalLight position={[0, -2, 4]} intensity={0.25} color="#00f0ff" />
    </>
  );
}

/**
 * CameraRig
 *
 * Owns the PerspectiveCamera instance. On every change of preset, FOV,
 * distance, or targetHeight, smoothly animates the camera to the new rig.
 */
function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const cam = useViewerStore((s) => s.camera);
  const lastPreset = useRef(cam.preset);
  const lastFov = useRef(cam.fov);
  const lastDistance = useRef(cam.distance);
  const lastTargetHeight = useRef(cam.targetHeight);

  // Apply the rig whenever the preset or tunables change.
  useEffect(() => {
    if (
      lastPreset.current !== cam.preset ||
      lastFov.current !== cam.fov ||
      lastDistance.current !== cam.distance ||
      lastTargetHeight.current !== cam.targetHeight
    ) {
      animateCameraToPreset(
        camera,
        cam.preset,
        { distance: cam.distance, targetHeight: cam.targetHeight, fov: cam.fov },
        { duration: 700 },
      );
      lastPreset.current = cam.preset;
      lastFov.current = cam.fov;
      lastDistance.current = cam.distance;
      lastTargetHeight.current = cam.targetHeight;
    }
  }, [camera, cam.preset, cam.fov, cam.distance, cam.targetHeight]);

  // Auto-rotate the model (not the camera) so cinematic mode doesn't fight OrbitControls.
  // Note: the model itself is rotated in SceneContents via autoRotate flag.
  // Here we just ensure FOV updates take effect immediately when changed mid-flight.
  useEffect(() => {
    if (cam.fov !== lastFov.current) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
      lastFov.current = cam.fov;
    }
  }, [camera, cam.fov]);

  const fov = CAMERA_PRESETS[cam.preset].fov ?? cam.fov;
  return (
    <PerspectiveCamera
      makeDefault
      fov={fov}
      position={[
        CAMERA_PRESETS[cam.preset].position[0] * cam.distance,
        CAMERA_PRESETS[cam.preset].position[1],
        CAMERA_PRESETS[cam.preset].position[2] * cam.distance,
      ]}
    />
  );
}

/**
 * CinematicOrbiter
 *
 * When the 'cinematic' preset is active, automatically orbit the camera
 * around the model's vertical axis. The camera distance is preserved.
 */
function CinematicOrbiter() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const preset = useViewerStore((s) => s.camera.preset);
  const distance = useViewerStore((s) => s.camera.distance);
  const targetHeight = useViewerStore((s) => s.camera.targetHeight);
  const speed = useViewerStore((s) => s.camera.cinematicSpeed);
  const angleRef = useRef(0);

  useFrame((_, delta) => {
    if (preset !== 'cinematic') return;
    angleRef.current += delta * speed;
    const radius = 5.5 * distance;
    camera.position.x = Math.cos(angleRef.current) * radius;
    camera.position.z = Math.sin(angleRef.current) * radius;
    camera.position.y = 2.4;
    camera.lookAt(0, targetHeight, 0);
  });

  return null;
}
