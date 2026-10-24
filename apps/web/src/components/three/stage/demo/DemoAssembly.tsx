'use client';

import type { ThreeEvent } from '@react-three/fiber';
import type { ReactNode } from 'react';

/**
 * Stage-local demo content: abstract placeholder volumes in millimeters, used
 * only to exercise lighting, materials, framing and selection. Not a product
 * renderer and not derived from a BuildPlan.
 */
export type DemoPreset = 'assembly' | 'wide' | 'tall' | 'small' | 'empty';

interface DemoAssemblyProps {
  preset: DemoPreset;
  selected: string | null;
  onSelect: (id: string) => void;
}

const BASE = '#7c8592';
const ACCENT = '#d98b3a';
const SELECT = '#4ea3ff';

function Part({
  id,
  selected,
  onSelect,
  color,
  metalness = 0.1,
  roughness = 0.55,
  children,
  ...transform
}: {
  id: string;
  selected: string | null;
  onSelect: (id: string) => void;
  color: string;
  metalness?: number;
  roughness?: number;
  children: ReactNode;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const isSelected = selected === id;
  return (
    <mesh
      {...transform}
      name={id}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect(id);
      }}
    >
      {children}
      <meshStandardMaterial
        color={isSelected ? SELECT : color}
        metalness={metalness}
        roughness={roughness}
        emissive={isSelected ? SELECT : '#000000'}
        emissiveIntensity={isSelected ? 0.25 : 0}
      />
    </mesh>
  );
}

export function DemoAssembly({ preset, selected, onSelect }: DemoAssemblyProps) {
  const common = { selected, onSelect };
  switch (preset) {
    case 'empty':
      return null;
    case 'wide':
      return (
        <Part id="beam" color={BASE} metalness={0.6} roughness={0.35} position={[0, 30, 0]} {...common}>
          <boxGeometry args={[1800, 40, 60]} />
        </Part>
      );
    case 'tall':
      return (
        <Part id="mast" color={BASE} metalness={0.6} roughness={0.35} position={[0, 700, 0]} {...common}>
          <boxGeometry args={[60, 1400, 60]} />
        </Part>
      );
    case 'small':
      return (
        <Part id="chip" color="#2b2f36" roughness={0.4} position={[0, 1.5, 0]} {...common}>
          <boxGeometry args={[6, 3, 6]} />
        </Part>
      );
    case 'assembly':
      return (
        <group>
          <Part id="plate" color="#3a4049" metalness={0.2} roughness={0.6} position={[0, 46, 0]} {...common}>
            <boxGeometry args={[150, 4, 190]} />
          </Part>
          <Part id="deck" color="#232830" roughness={0.7} position={[0, 72, -10]} {...common}>
            <boxGeometry args={[110, 3, 130]} />
          </Part>
          {[-1, 1].map((side) => (
            <group key={side}>
              <Part
                id={`cylinder-${side < 0 ? 'l' : 'r'}`}
                color="#1b1d21"
                roughness={0.85}
                position={[side * 90, 33, 35]}
                rotation={[0, 0, Math.PI / 2]}
                {...common}
              >
                <cylinderGeometry args={[33, 33, 26, 48]} />
              </Part>
              <Part
                id={`hub-${side < 0 ? 'l' : 'r'}`}
                color={ACCENT}
                metalness={0.3}
                roughness={0.4}
                position={[side * 104, 33, 35]}
                rotation={[0, 0, Math.PI / 2]}
                {...common}
              >
                <cylinderGeometry args={[12, 12, 3, 32]} />
              </Part>
              <Part
                id={`block-${side < 0 ? 'l' : 'r'}`}
                color="#c9ccd1"
                metalness={0.8}
                roughness={0.3}
                position={[side * 55, 33, 35]}
                rotation={[0, 0, Math.PI / 2]}
                {...common}
              >
                <cylinderGeometry args={[12, 12, 46, 32]} />
              </Part>
            </group>
          ))}
          <Part id="board" color="#1d5c3f" roughness={0.5} position={[0, 78, -20]} {...common}>
            <boxGeometry args={[52, 6, 28]} />
          </Part>
          <Part id="pack" color="#30343b" roughness={0.65} position={[0, 60, -55]} {...common}>
            <boxGeometry args={[70, 22, 40]} />
          </Part>
          <Part id="puck" color={ACCENT} metalness={0.2} roughness={0.45} position={[0, 62, 92]} {...common}>
            <boxGeometry args={[45, 20, 12]} />
          </Part>
          <Part id="ball" color="#c9ccd1" metalness={0.9} roughness={0.2} position={[0, 10, -70]} {...common}>
            <sphereGeometry args={[10, 32, 16]} />
          </Part>
        </group>
      );
  }
}
