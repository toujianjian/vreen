// BallGamePage — VREEN 3D 小游戏 Demo
// 玩法:一个圆球作为第一人称主体,在一个立方体(四方体)平台的顶面上滚动移动。
// 操作:WASD / 方向键控制滚动方向(相对相机朝向);滚出边缘会坠落并自动重生。
// 技术:React Three Fiber + three.js,自研轻量滚动运动学(无第三方物理库)。

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { Link } from 'react-router-dom';
import { RotateCcw, Gamepad2, Orbit, ChevronDown } from 'lucide-react';

/* ── 游戏常量 ───────────────────────────────────────────────────────────
 * 高度体系以「平台顶面高度 PLATFORM_TOP_Y」为唯一真源:
 *   平台盒体:高 PLATFORM_HEIGHT,中心在 y = PLATFORM_TOP_Y - PLATFORM_HEIGHT/2,
 *             因此顶面恰好在 y = PLATFORM_TOP_Y。
 *   球静止时球心: SURFACE_Y = PLATFORM_TOP_Y + BALL_R(球恰好坐在顶面上)。
 */
const PLATFORM_TOP_Y = 1; // 平台顶面高度
const PLATFORM_HEIGHT = 2; // 平台厚度(盒体高度)
const PLATFORM_HALF = 6; // 顶面半宽(顶面为 12x12)
const BALL_R = 0.55; // 球半径
const SURFACE_Y = PLATFORM_TOP_Y + BALL_R; // 球静止时的球心高度

const ACCEL = 34;
const MAX_SPEED = 11;
const FRICTION = 7;
const GRAVITY = 22;
const ROLL_BOUND = PLATFORM_HALF - BALL_R * 0.7; // 顶面边缘判定
const RESPAWN_Y = -14; // 坠落到此高度后重生

/* 键盘状态 */
function useKeys() {
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.code)) {
        e.preventDefault();
      }
      keys.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  return keys;
}

interface Stats {
  speed: number;
  pos: string;
  grounded: boolean;
}

export function BallGamePage() {
  const keys = useKeys();
  const [stats, setStats] = useState<Stats>({ speed: 0, pos: '0.0,0.0', grounded: true });
  const [oob, setOob] = useState(false); // 是否掉出平台
  const [viewMode, setViewMode] = useState<'chase' | 'first'>('chase');
  const [helpOpen, setHelpOpen] = useState(true);
  const [resetCount, setResetCount] = useState(0);

  // 相机水平朝向(由玩家控制,不随速度变化)——这是修复 ASD 视角乱转的关键
  const containerRef = useRef<HTMLDivElement>(null);
  const yawRef = useRef(0);
  const dragRef = useRef({ active: false, lastX: 0 });

  // 鼠标拖动(水平)旋转相机朝向
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const down = (e: PointerEvent) => {
      dragRef.current.active = true;
      dragRef.current.lastX = e.clientX;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const move = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.lastX;
      dragRef.current.lastX = e.clientX;
      yawRef.current += dx * 0.005;
    };
    const up = () => { dragRef.current.active = false; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);

  const onStats = (s: { speed: number; pos: string; grounded: boolean; oob: boolean }) => {
    setStats({ speed: s.speed, pos: s.pos, grounded: s.grounded });
    if (s.oob) setOob(true);
  };

  return (
    <div ref={containerRef} className="relative w-full h-[calc(100vh-3.5rem)] bg-space-950 overflow-hidden cursor-grab active:cursor-grabbing select-none">
      <Canvas
        dpr={[1, 2]}
        shadows
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [8, PLATFORM_TOP_Y + 5, 8], fov: 60, near: 0.1, far: 300 }}
      >
        <color attach="background" args={['#05070d']} />
        <fog attach="fog" args={['#05070d', 24, 60]} />
        <SceneGeometry />
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[8, 14, 6]}
          intensity={1.7}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={14}
          shadow-camera-bottom={-14}
          shadow-bias={-0.0005}
        />
        <directionalLight position={[-8, 6, -10]} intensity={0.35} color="#7bd6ff" />
        <BallActor
          keysRef={keys}
          onStats={onStats}
          spawnSeq={resetCount}
          viewMode={viewMode}
          yawRef={yawRef}
        />
        <pointLight position={[0, 6, 0]} intensity={8} distance={20} color="#22d3ee" />
      </Canvas>

      {/* 顶部标题 HUD */}
      <div className="pointer-events-none absolute top-3 left-3 z-10">
        <div className="hud-panel px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-neon-cyan animate-pulse shadow-glow" />
            <span className="font-display text-[12px] tracking-[0.22em] text-neon-cyan">
              BALL // PLATFORM
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[9px] tracking-[0.18em] text-mist">
            第一人称圆球 · 立方体平台
          </p>
        </div>
      </div>

      {/* 右上角:状态 + 视图切换 */}
      <div className="pointer-events-auto absolute top-3 right-3 z-10 flex items-center gap-2">
        <div className="hud-panel px-3 py-2 font-mono text-[10px] text-mist hidden sm:block">
          <div className="flex items-center justify-between gap-4">
            <span>VEL</span>
            <span className="text-neon-cyan tabular-nums">{stats.speed.toFixed(1)} u/s</span>
          </div>
          <div className="flex items-center justify-between gap-4 mt-0.5">
            <span>POS</span>
            <span className="text-haze tabular-nums">
              {stats.pos}
              {stats.grounded ? '' : ' · AIR'}
            </span>
          </div>
        </div>
        <div className="hud-panel px-1.5 py-1.5 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'chase' ? 'first' : 'chase')}
            className={`hud-btn hud-btn-ghost !px-2 !py-1 ${viewMode === 'chase' ? '!text-neon-cyan' : ''}`}
            title="切换第一人称 / 跟随视角"
          >
            <Orbit className="w-3.5 h-3.5" />
            <span className="text-[9px] tracking-[0.16em]">
              {viewMode === 'chase' ? 'CHASE' : '1ST'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setResetCount((c) => c + 1);
              setOob(false);
            }}
            className="hud-btn hud-btn-ghost !px-2 !py-1"
            title="重生到平台中心"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 掉出提示 */}
      {oob && (
        <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 z-10 text-center">
          <div className="hud-panel px-6 py-3 border-neon-magenta/50 text-neon-magenta animate-pulse">
            <div className="font-display text-sm tracking-[0.3em]">↯ 滚出平台 · 重生中</div>
          </div>
        </div>
      )}

      {/* 左下角:控制帮助 */}
      <div className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-[300px]">
        <div className="hud-panel px-3 py-2">
          <button
            type="button"
            onClick={() => setHelpOpen((o) => !o)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-1.5 text-neon-cyan">
              <Gamepad2 className="w-3.5 h-3.5" />
              <span className="font-display text-[10px] tracking-[0.22em]">CONTROLS</span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-mist transition-transform ${helpOpen ? '' : 'rotate-180'}`} />
          </button>
          {helpOpen && (
            <ul className="mt-2 space-y-1 text-[10px] font-mono text-mist">
              <li>
                <span className="text-haze">W A S D</span> / <span className="text-haze">↑↓←→</span> 滚动方向
              </li>
              <li>
                <span className="text-haze">鼠标拖动</span> / <span className="text-haze">Q·E</span> 旋转视角
              </li>
              <li>
                <span className="text-haze">SPACE</span> 急停
              </li>
              <li>球体不可离开顶面,滚出边缘会坠落重生</li>
            </ul>
          )}
        </div>
      </div>

      {/* 右下角:返回 */}
      <Link
        to="/"
        className="pointer-events-auto absolute bottom-3 right-3 z-10 hud-btn hud-btn-ghost"
        aria-label="back"
      >
        ← HOME
      </Link>
    </div>
  );
}

/* ── 静态场景:立方体平台 + 地面网格 + 装饰 ─────────────────────────────── */
function SceneGeometry() {
  const boxCenterY = PLATFORM_TOP_Y - PLATFORM_HEIGHT / 2;
  const edgeY = PLATFORM_TOP_Y + 0.005;
  const half = PLATFORM_HALF;
  // 顶面边缘发光框的四个角点(逆时针,构成闭合边框)
  const edgePts = new Float32Array([
    -half, edgeY, -half, half, edgeY, -half,
    half, edgeY, -half, half, edgeY, half,
    half, edgeY, half, -half, edgeY, half,
    -half, edgeY, half, -half, edgeY, -half,
  ]);

  return (
    <group>
      {/* 下方地面参考网格 */}
      <gridHelper args={[46, 36, '#123', '#0a1424']} position={[0, -1.5, 0]} />

      {/* 立方体平台(盒体中心在顶面下方 PLATFORM_HEIGHT/2 处) */}
      <mesh position={[0, boxCenterY, 0]} receiveShadow castShadow>
        <boxGeometry args={[PLATFORM_HALF * 2, PLATFORM_HEIGHT, PLATFORM_HALF * 2]} />
        <meshStandardMaterial
          color="#101a30"
          metalness={0.55}
          roughness={0.35}
          transparent
          opacity={0.96}
          envMapIntensity={1}
        />
      </mesh>

      {/* 顶面网格线(视觉参考) */}
      <gridHelper
        args={[PLATFORM_HALF * 2, 12, '#22d3ee', '#0e2a44']}
        position={[0, PLATFORM_TOP_Y + 0.01, 0]}
      />

      {/* 顶面边缘发光框 */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[edgePts, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#22d3ee" transparent opacity={0.8} />
      </lineSegments>

      {/* 顶面出生点指示圆环 */}
      <mesh position={[0, PLATFORM_TOP_Y + 0.02, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[1.6, 1.8, 48]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.35} side={2} />
      </mesh>
    </group>
  );
}

/* ── 圆球主体(第一人称对象) ────────────────────────────────────────────── */
interface BallActorProps {
  keysRef: MutableRefObject<Record<string, boolean>>;
  onStats: (s: { speed: number; pos: string; grounded: boolean; oob: boolean }) => void;
  spawnSeq: number;
  viewMode: 'chase' | 'first';
  yawRef: MutableRefObject<number>;
}

function BallActor({ keysRef, onStats, spawnSeq, viewMode, yawRef }: BallActorProps) {
  const sphereRef = useRef<Group>(null);
  const { camera } = useThree();

  // 相机落后距离(仅位置滞后,朝向由 yawRef 决定,不随速度转)
  const camState = useRef({ lag: 0 });

  const state = useRef({
    pos: { x: 0, z: 0 },
    vel: { x: 0, z: 0 },
    y: SURFACE_Y,
    vy: 0,
    grounded: true,
    oob: false,
    fallen: false,
    rotX: 0,
    rotZ: 0,
  });

  // 重生(依赖 spawnSeq)
  useEffect(() => {
    const s = state.current;
    s.pos = { x: 0, z: 0 };
    s.vel = { x: 0, z: 0 };
    s.y = SURFACE_Y;
    s.vy = 0;
    s.grounded = true;
    s.oob = false;
    s.fallen = false;
    s.rotX = 0;
    s.rotZ = 0;
  }, [spawnSeq]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = state.current;
    const keys = keysRef.current;

    // 相机朝向由玩家控制:Q/E 键旋转(鼠标拖动在父组件处理)
    if (keys['KeyQ']) yawRef.current += 2.4 * dt;
    if (keys['KeyE']) yawRef.current -= 2.4 * dt;
    const yaw = yawRef.current;

    // 输入方向(相机相对):W/S 为前后,A/D 为左右
    let ix = 0;
    let iz = 0;
    if (keys['KeyW'] || keys['ArrowUp']) iz += 1; // 前
    if (keys['KeyS'] || keys['ArrowDown']) iz -= 1; // 后
    if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1; // 左
    if (keys['KeyD'] || keys['ArrowRight']) ix += 1; // 右

    // 相机水平基向量(与 yaw 一致,稳定不随速度变化)
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    if (s.grounded) {
      if (ix !== 0 || iz !== 0) {
        const wx = forwardX * iz + rightX * ix;
        const wz = forwardZ * iz + rightZ * ix;
        const mag = Math.hypot(wx, wz) || 1;
        s.vel.x += (wx / mag) * ACCEL * dt;
        s.vel.z += (wz / mag) * ACCEL * dt;
      }

      // 限速
      const sp = Math.hypot(s.vel.x, s.vel.z);
      if (sp > MAX_SPEED) {
        s.vel.x = (s.vel.x / sp) * MAX_SPEED;
        s.vel.z = (s.vel.z / sp) * MAX_SPEED;
      }

      // 摩擦
      s.vel.x -= s.vel.x * FRICTION * dt;
      s.vel.z -= s.vel.z * FRICTION * dt;

      // 空间键急停
      if (keys['Space']) {
        s.vel.x *= 0.8;
        s.vel.z *= 0.8;
      }

      s.pos.x += s.vel.x * dt;
      s.pos.z += s.vel.z * dt;

      // 顶面边界判定:仍在上方则贴着顶面,否则进入坠落
      const onTop = Math.abs(s.pos.x) < ROLL_BOUND && Math.abs(s.pos.z) < ROLL_BOUND;
      if (onTop) {
        s.y = SURFACE_Y;
        s.vy = 0;
        s.grounded = true;
      } else {
        s.grounded = false;
        s.vy = Math.max(s.vy, -1);
      }
    } else {
      // 空中:保留水平惯性 + 重力下落
      s.pos.x += s.vel.x * dt;
      s.pos.z += s.vel.z * dt;
      s.vy -= GRAVITY * dt;
      s.y += s.vy * dt;
      if (s.y < RESPAWN_Y && !s.fallen) {
        s.fallen = true;
        s.oob = true;
      }
    }

    // 滚动旋转(无滑动滚动):v = ω × r
    //  沿 +z 滚动 → 绕 x 轴负向旋转;沿 +x 滚动 → 绕 z 轴正向旋转
    s.rotX -= (s.vel.z / BALL_R) * dt;
    s.rotZ += (s.vel.x / BALL_R) * dt;

    // 应用到容器
    const g = sphereRef.current;
    if (g) {
      g.position.set(s.pos.x, s.y, s.pos.z);
      g.rotation.set(s.rotX, 0, s.rotZ);
    }

    // 相机落后距离(仅位置滞后;朝向已由 yaw 决定,不再随速度翻转)
    const speed = Math.hypot(s.vel.x, s.vel.z);
    const speedRatio = Math.min(1, speed / MAX_SPEED);
    const targetLag = 3.2 + speedRatio * 3.2;
    camState.current.lag += (targetLag - camState.current.lag) * Math.min(1, dt * 3);

    const camY = SURFACE_Y + 0.8 + speedRatio * 1.6;

    if (viewMode === 'chase') {
      // 跟随视角:相机在球后上方(相对 yaw 的后方),朝向始终由 yaw 决定
      const backX = s.pos.x + Math.sin(yaw) * camState.current.lag;
      const backZ = s.pos.z + Math.cos(yaw) * camState.current.lag;
      const k = Math.min(1, dt * 8);
      camera.position.set(
        camera.position.x + (backX - camera.position.x) * k,
        camera.position.y + (camY - camera.position.y) * k,
        camera.position.z + (backZ - camera.position.z) * k,
      );
      camera.lookAt(s.pos.x, s.y, s.pos.z);
    } else {
      // 第一人称:相机在球心,看向朝向方向
      const k = Math.min(1, dt * 20);
      camera.position.set(
        camera.position.x + (s.pos.x - camera.position.x) * k,
        camera.position.y + (s.y - camera.position.y) * k,
        camera.position.z + (s.pos.z - camera.position.z) * k,
      );
      camera.lookAt(
        s.pos.x + forwardX * 5,
        s.y,
        s.pos.z + forwardZ * 5,
      );
    }

    const posStr = `${s.pos.x.toFixed(1)},${s.pos.z.toFixed(1)}`;
    onStats({ speed, pos: posStr, grounded: s.grounded, oob: s.fallen && s.oob });
  });

  return (
    <group ref={sphereRef}>
      {viewMode === 'chase' ? (
        <>
          {/* 球体本体 */}
          <mesh castShadow>
            <sphereGeometry args={[BALL_R, 48, 48]} />
            <meshStandardMaterial
              color="#22d3ee"
              metalness={0.4}
              roughness={0.25}
              emissive="#0e7490"
              emissiveIntensity={0.35}
            />
          </mesh>
          {/* 经纬环(视觉上体现球体滚动) */}
          <mesh rotation-y={Math.PI / 2}>
            <torusGeometry args={[BALL_R * 1.02, 0.035, 12, 64]} />
            <meshBasicMaterial color="#a5f3fc" transparent opacity={0.9} />
          </mesh>
          {/* 球体前端标记点(朝向运动方向) */}
          <mesh position={[0, 0, BALL_R]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </>
      ) : (
        /* 第一人称:看球内部 → 半透明球体天幕 */
        <mesh>
          <sphereGeometry args={[BALL_R, 48, 48]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.15} side={1} />
        </mesh>
      )}
    </group>
  );
}