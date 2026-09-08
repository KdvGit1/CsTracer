export type RadarGeometry = { posX: number; posY: number; scale: number; lowerImage?: string; lowerMaxZ?: number };
export function worldToRadar(x: number, y: number, map: RadarGeometry): { left: number; top: number };
export function radarPathSegments(points: { x: number; y: number; z: number; tick: number }[], map: RadarGeometry, level?: string, tickRate?: number): { left: number; top: number }[][];
