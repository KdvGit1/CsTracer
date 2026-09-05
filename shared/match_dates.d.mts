export function validMatchDate(value: unknown): number;
export function downloadedDemoMeta(match?: { id: string; timestamp?: number; fileName?: string; map?: string }): { matchId: string; fileName: string; lastModified: number; matchDate: number; size: number } | null;
export function progressMatchDate(matchId: string, incomingDate: unknown, archived?: Array<{ id: string; timestamp?: number }>, scanned?: Array<{ id: string; timestamp?: number }>, existing?: Array<{ id: string; date?: number }>): number;
