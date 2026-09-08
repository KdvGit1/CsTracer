export type ViewCamera = { origin: number[]; forward: number[]; right: number[]; up: number[]; tanH: number; tanV: number; fov: number; aspect: number };
export function dot3(a: number[], b: number[]): number;
export function cameraFor(row: Record<string, unknown>): ViewCamera | null;
export function projectPoint(camera: ViewCamera | null, point: number[] | null): { x: number; y: number; depth: number; inFrame: boolean } | null;
export function bodyPoints(row: Record<string, unknown>): number[][];
export function segmentSphere(start: number[], end: number[], center: number[], radius: number): boolean;
export function projectShotDirection(camera: ViewCamera, shot: { origin: number[] | null; direction: number[] | null; target: number[] | null }): { start: NonNullable<ReturnType<typeof projectPoint>>; end: NonNullable<ReturnType<typeof projectPoint>>; clipped: boolean } | null;
