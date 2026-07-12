// EntityGraph — 力导向图展示 entity ↔ component 关系。
//
// 实现说明：
// - 节点分两类：entity（圆形）/ component type（六边形/方块）
// - 力：斥力（节点-节点） + 引力（entity-component 连线） + 中心向心力
// - 60 fps 动画通过 requestAnimationFrame；点击节点 → 选择 entity
// - 无外部依赖 (d3 / react-flow)，用纯 SVG 自绘

import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/cn';

interface GraphNode {
  id: string;
  kind: 'entity' | 'component';
  label: string;
  entityId?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
}

interface EntityGraphProps {
  entities: ReadonlyArray<{ id: number; name: string; components: string[] }>;
  selectedEntityId: number | null;
  onSelectEntity: (id: number) => void;
  width?: number;
  height?: number;
}

const ENTITY_RADIUS = 6;
const COMP_RADIUS = 12;
const REPULSION = 1800;
const SPRING = 0.04;
const DAMPING = 0.85;
const CENTER_FORCE = 0.005;

function buildGraph(entities: EntityGraphProps['entities']): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  componentTypes: string[];
} {
  const componentTypes = new Set<string>();
  for (const e of entities) {
    for (const c of e.components) componentTypes.add(c);
  }

  const W = 400;
  const H = 300;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Component nodes in a ring at the center
  const compArr = Array.from(componentTypes);
  compArr.forEach((c, i) => {
    const angle = (i / Math.max(1, compArr.length)) * Math.PI * 2;
    const r = Math.min(W, H) * 0.3;
    nodes.push({
      id: `cmp:${c}`,
      kind: 'component',
      label: c,
      x: W / 2 + Math.cos(angle) * r,
      y: H / 2 + Math.sin(angle) * r,
      vx: 0, vy: 0,
      pinned: true,
    });
  });

  // Entity nodes around the rim
  entities.forEach((e, i) => {
    const angle = (i / Math.max(1, entities.length)) * Math.PI * 2 + 0.4;
    const r = Math.min(W, H) * 0.45;
    nodes.push({
      id: `ent:${e.id}`,
      kind: 'entity',
      label: e.name,
      entityId: e.id,
      x: W / 2 + Math.cos(angle) * r,
      y: H / 2 + Math.sin(angle) * r,
      vx: 0, vy: 0,
    });
    for (const c of e.components) {
      edges.push({ source: `ent:${e.id}`, target: `cmp:${c}` });
    }
  });

  return { nodes, edges, componentTypes: compArr };
}

function stepSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  W: number,
  H: number,
): void {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // 1. Repulsion (O(n^2) — fine for n < 200)
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy + 0.01;
      const d = Math.sqrt(d2);
      const f = REPULSION / d2;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
  }

  // 2. Spring (entity-component) — pulls connected pairs together
  for (const e of edges) {
    const a = nodeById.get(e.source);
    const b = nodeById.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    a.vx += dx * SPRING;
    a.vy += dy * SPRING;
    b.vx -= dx * SPRING;
    b.vy -= dy * SPRING;
  }

  // 3. Center force — keep things on screen
  for (const n of nodes) {
    n.vx += (W / 2 - n.x) * CENTER_FORCE;
    n.vy += (H / 2 - n.y) * CENTER_FORCE;
  }

  // 4. Integrate + damping + bounds
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    n.x += n.vx;
    n.y += n.vy;
    n.x = Math.max(ENTITY_RADIUS, Math.min(W - ENTITY_RADIUS, n.x));
    n.y = Math.max(ENTITY_RADIUS, Math.min(H - ENTITY_RADIUS, n.y));
  }
}

export function EntityGraph({
  entities,
  selectedEntityId,
  onSelectEntity,
  width = 400,
  height = 300,
}: EntityGraphProps) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const W = expanded ? Math.min(window.innerWidth - 80, 800) : width;
  const H = expanded ? Math.min(window.innerHeight - 200, 600) : height;

  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = buildGraph(entities);
    // Pre-run 80 simulation steps so the initial frame isn't a mess
    for (let i = 0; i < 80; i++) stepSimulation(nodes, edges, width, height);
    return { initialNodes: nodes, initialEdges: edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.length, width, height, expanded]);

  const nodesRef = useRef<GraphNode[]>(initialNodes);
  const edgesRef = useRef<GraphEdge[]>(initialEdges);
  const [nodePositions, setNodePositions] = useState<GraphNode[]>(initialNodes);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    nodesRef.current = initialNodes;
    edgesRef.current = initialEdges;
    setNodePositions(initialNodes);
  }, [initialNodes, initialEdges]);

  useEffect(() => {
    const tick = () => {
      stepSimulation(nodesRef.current, edgesRef.current, W, H);
      setNodePositions(nodesRef.current.slice());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [W, H]);

  const nodeById = useMemo(
    () => new Map(nodePositions.map((n) => [n.id, n])),
    [nodePositions],
  );

  if (entities.length === 0) {
    return (
      <div className="text-mist font-mono text-[10px] py-2">
        No entities to graph
      </div>
    );
  }

  const renderNode = (n: GraphNode) => {
    const isEntity = n.kind === 'entity';
    const r = isEntity ? ENTITY_RADIUS : COMP_RADIUS;
    const isSelected = n.entityId === selectedEntityId;
    const isHovered = hoveredId === n.id;

    return (
      <g
        key={n.id}
        transform={`translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`}
        onMouseEnter={() => setHoveredId(n.id)}
        onMouseLeave={() => setHoveredId(null)}
        onClick={() => isEntity && n.entityId != null && onSelectEntity(n.entityId)}
        style={{ cursor: isEntity ? 'pointer' : 'default' }}
      >
        {isEntity ? (
          <circle
            r={r}
            fill={isSelected ? '#22d3ee' : isHovered ? '#67e8f9' : '#0e7490'}
            stroke="#22d3ee"
            strokeWidth={isSelected ? 1.5 : 0.5}
          />
        ) : (
          <rect
            x={-r} y={-r} width={r * 2} height={r * 2}
            transform="rotate(45)"
            fill="#1e1b4b"
            stroke="#a78bfa"
            strokeWidth={0.8}
          />
        )}
        {(isSelected || isHovered || !isEntity) && (
          <text
            x={isEntity ? r + 4 : r + 2}
            y={3}
            fontSize={isEntity ? 9 : 10}
            fontFamily="monospace"
            fill={isEntity ? '#a5f3fc' : '#c4b5fd'}
            style={{ pointerEvents: 'none' }}
          >
            {n.label}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="border border-neon-cyan/15 bg-space-900/40">
      <div className="flex items-center justify-between px-2 py-1 border-b border-neon-cyan/10">
        <span className="hud-label flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan" />
          REL GRAPH · {entities.length} ents / {nodesRef.current.filter((n) => n.kind === 'component').length} comps
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="hud-btn hud-btn-ghost !p-1"
          title={expanded ? 'collapse' : 'expand'}
        >
          {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>
      </div>
      <div className={cn('relative', expanded && 'fixed inset-10 z-50 bg-space-900/95 border border-neon-cyan/30')}>
        <svg
          width={expanded ? '100%' : W}
          height={expanded ? '100%' : H}
          viewBox={`0 0 ${W} ${H}`}
          className="block"
        >
          {/* Edges */}
          {initialEdges.map((e, i) => {
            const a = nodeById.get(e.source);
            const b = nodeById.get(e.target);
            if (!a || !b) return null;
            const isHighlighted = hoveredId === e.source || hoveredId === e.target;
            return (
              <line
                key={i}
                x1={a.x} y1={a.y}
                x2={b.x} y2={b.y}
                stroke={isHighlighted ? '#22d3ee' : '#0891b2'}
                strokeOpacity={isHighlighted ? 0.7 : 0.25}
                strokeWidth={isHighlighted ? 1 : 0.5}
              />
            );
          })}
          {/* Nodes */}
          {nodesRef.current.map(renderNode)}
        </svg>
      </div>
    </div>
  );
}
