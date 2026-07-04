// Animated background: floating wireframe primitives + particles + grid
// Built with R3F so it can be used as a "wallpaper" on hero or as standalone decoration.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface BackgroundSceneProps {
  intensity?: 'low' | 'medium' | 'high';
  rotate?: boolean;
}

export function BackgroundScene({ intensity = 'medium', rotate = true }: BackgroundSceneProps) {
  const group = useRef<THREE.Group>(null);

  const particles = useMemo(() => {
    const count = intensity === 'high' ? 2200 : intensity === 'medium' ? 1200 : 600;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    return positions;
  }, [intensity]);

  useFrame((_, delta) => {
    if (group.current && rotate) {
      group.current.rotation.y += delta * 0.05;
    }
  });

  return (
    <group ref={group}>
      {/* Particles */}
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[particles, 3]}
            count={particles.length / 3}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.025}
          color="#00f0ff"
          transparent
          opacity={0.7}
          sizeAttenuation
          depthWrite={false}
        />
      </points>

      {/* Wireframe icosahedron — centerpiece */}
      <mesh position={[0, 0, -2]}>
        <icosahedronGeometry args={[2.2, 1]} />
        <meshBasicMaterial color="#00f0ff" wireframe transparent opacity={0.18} />
      </mesh>
      <mesh position={[0, 0, -2]}>
        <icosahedronGeometry args={[1.45, 2]} />
        <meshBasicMaterial color="#ff2bd6" wireframe transparent opacity={0.22} />
      </mesh>
      <mesh position={[0, 0, -2]}>
        <icosahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial
          color="#101828"
          emissive="#00f0ff"
          emissiveIntensity={0.6}
          metalness={0.9}
          roughness={0.2}
        />
      </mesh>

      {/* Orbiting rings */}
      <mesh rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[3.4, 0.012, 8, 96]} />
        <meshBasicMaterial color="#00f0ff" transparent opacity={0.45} />
      </mesh>
      <mesh rotation={[Math.PI / 2.2, 0, Math.PI / 4]}>
        <torusGeometry args={[3.9, 0.008, 8, 96]} />
        <meshBasicMaterial color="#ff2bd6" transparent opacity={0.35} />
      </mesh>

      {/* Floating cubes */}
      {[
        [-4.5, 1.8, -3],
        [4.2, -1.5, -2],
        [-3.8, -2.0, -1],
        [3.6, 2.2, -4],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[0.4, 0.6, 0.2]}>
          <boxGeometry args={[0.35, 0.35, 0.35]} />
          <meshBasicMaterial color={i % 2 === 0 ? '#00f0ff' : '#ff2bd6'} wireframe />
        </mesh>
      ))}
    </group>
  );
}
