// Small rotating model preview used inside gallery cards.
// Renders one of the 6 procedural archetypes inside a mini Canvas.
import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import type { Object3D as ThreeObject3D } from 'three';
import { SafeEnvironment } from '@/components/three/SafeEnvironment';
import { GENERATORS } from '@/three/generators';
import { normalizeObject } from '@/three/normalize';

interface PresetPreviewProps {
  generator: keyof typeof GENERATORS;
  className?: string;
  rotate?: boolean;
  exposure?: number;
}

function PreviewMesh({ generator }: { generator: keyof typeof GENERATORS }) {
  const group = useMemo(() => {
    const g = GENERATORS[generator]();
    // 自研 Group -> three.js 渲染管线边界。step2.7/2.8 阶段会彻底走自研渲染管线。
    normalizeObject(g as unknown as ThreeObject3D, { targetSize: 1.6, sitOnGround: true });
    return g;
  }, [generator]);

  return <primitive object={group as unknown as object} />;
}

export function PresetPreview({ generator, className, rotate = true, exposure = 1.0 }: PresetPreviewProps) {
  return (
    <div className={className}>
      <Canvas
        shadows
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
        camera={{ position: [2.6, 1.6, 2.6], fov: 32 }}
      >
        <color attach="background" args={['#05070d']} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[3, 4, 2]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={512}
          shadow-mapSize-height={512}
        />
        <Suspense fallback={null}>
          <PreviewMesh generator={generator} />
          <SafeEnvironment preset="city" environmentIntensity={0.55 * exposure} />
        </Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={4} blur={2.4} far={2.5} />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate={rotate}
          autoRotateSpeed={1.6}
        />
      </Canvas>
    </div>
  );
}
