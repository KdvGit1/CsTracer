export type Recommendation = { id: string; title: string; body: string; confidence: number };
export type DeathDetail = {
  round: number; tick: number; time: number; zone: string; x: number; y: number; z: number;
  killer: string; weapon: string; nearestTeammate: number | null; usedRecentFlash: boolean;
  traded: boolean; side: "CT" | "T" | "Unknown"; speed?: number; openingDeath?: boolean; wasBlind?: boolean;
};
export type KillDetail = {
  round: number; tick: number; time: number; zone: string; x: number; y: number; z: number;
  victim: string; weapon: string; headshot: boolean; side: "CT" | "T" | "Unknown";
};
export type SideStat = {
  side: "CT" | "T"; rounds: number; kills: number; deaths: number; assists: number; damage: number;
  adr: number; shots: number; movingShotPercent: number; tradePercent: number; topZone: string; topZoneDeaths: number;
};
export type WeaponStat = {
  weapon: string; label: string; category?: string; kills: number; damage: number; shots: number; headshots: number;
  headshotPercent: number; movingShotPercent: number; efficiency: number; score: number;
  status: "signature" | "strong" | "developing" | "sample";
};
export type MovementCategoryStat = { shots: number; movingPercent: number };
export type MovementProfile = {
  averageSpeed: number; p90Speed: number; stableShots: number; microMoveShots: number;
  movingShots: number; fastMoveShots: number; stablePercent: number; microPercent: number;
  movingPercent: number; fastPercent: number; severityScore: number;
  severity: "clean" | "minor" | "moderate" | "severe";
  byCategory?: {
    sniper?: MovementCategoryStat;
    rifle?: MovementCategoryStat;
    pistol?: MovementCategoryStat;
    smg?: MovementCategoryStat;
    other?: MovementCategoryStat;
  };
};
export type SprayStats = {
  totalShots: number;
  totalHits: number;
  accuracyPercent: number;
  earlyAccuracy: number;
  lateAccuracy: number;
  hitboxCounts: { head: number; chest: number; stomach: number; arms: number; legs: number };
  hitboxPercents: { head: number; chest: number; stomach: number; arms: number; legs: number };
};
export type CrosshairStats = {
  headErrorAngle: number;
  bodyErrorAngle: number;
  preAimScore: number;
  headLevelRating: string;
};
export type DuelStats = {
  averageTTD: number;
  duelWinrate: number;
  duelWins: number;
  duelTotal: number;
  fastReactions: number;
  reactionRating: string;
};
export type RoundEconomy = {
  round: number;
  startMoney: number;
  spentMoney: number;
  endMoney: number;
  buyType: string;
  heroBuy: boolean;
};
export type EconomyStats = {
  averageStartMoney: number;
  totalCashSpent: number;
  roundEconomy: RoundEconomy[];
  ecoRounds: number;
  forceRounds: number;
  fullBuyRounds: number;
};
export type PathPoint = { x: number; y: number; z: number; zone: string; tick: number };
export type RoundPath = {
  round: number;
  side: "CT" | "T" | "Unknown";
  won: boolean;
  winnerSide: "CT" | "T";
  winReason: string;
  durationSeconds: number;
  startZone: string;
  endZone: string;
  primaryZone: string;
  routeSummary: string;
  points: PathPoint[];
};
export type RouteStat = {
  side: "CT" | "T" | "Unknown";
  zone: string;
  totalRounds: number;
  wins: number;
  losses: number;
  winrate: number;
  kills: number;
  deaths: number;
  avgX: number;
  avgY: number;
  isBestRoute?: boolean;
};
export type PlayerReport = {
  player: { name: string; steamid: string }; map: string; rounds: number; kills: number; deaths: number;
  assists: number; adr: number; headshotPercent: number; openingKills: number; openingDeaths: number;
  utilityDamage: number; enemyBlindSeconds: number; flashesThrown: number; shots: number;
  movingShotPercent: number; tradePercent: number; topZone: string; topZoneDeaths: number;
  unflashedDeaths: number; untradedDeaths: number; impact: number; deathDetails: DeathDetail[];
  killDetails?: KillDetail[]; sideStats?: SideStat[]; weaponStats?: WeaponStat[]; movementProfile?: MovementProfile;
  sprayStats?: SprayStats; crosshairStats?: CrosshairStats; duelStats?: DuelStats; economyStats?: EconomyStats;
  roundPaths?: RoundPath[]; routeStats?: RouteStat[];
  recommendations: Recommendation[];
};
export type ErrorSeverity = "critical" | "high" | "moderate" | "minor" | "info" | "strong";
export type CoachRule = { id: string; area: string; title: string; target: string; rationale: string; caveat: string };
export type CoachFinding = {
  id: string; area: string; title: string; evidence: string; interpretation: string;
  action: string; severity: ErrorSeverity; confidence: number;
};
export type DeathPattern = {
  id: string; category: string; title: string; count: number; share: number; severity: Exclude<ErrorSeverity, "strong">;
  confidence: number; evidence: string; interpretation: string; rounds: number[];
};
export type CoachPacket = {
  title: string; summary: string; confidence: number; findings: CoachFinding[];
  priorities: CoachFinding[]; strengths: CoachFinding[];
  dimensions: { area: string; status: ErrorSeverity; label: string }[];
  positionZones: { zone: string; deaths: number; share: number }[];
};
export type AiInsight = {
  title: string;
  summary: string;
  priorities: { area: string; evidence: string; interpretation: string; action: string }[];
  strengths: string[];
  sessionPlan: string;
  confidence?: number;
};
export type FullMatchReport = {
  generatedAt: number;
  isAiGenerated: boolean;
  title: string;
  summary: string;
  matchScorecard: {
    overallScore: number;
    grade: string;
    impactScore: number;
    aimScore: number;
    movementScore: number;
    utilityScore: number;
    teamworkScore: number;
    positionScore: number;
    economyScore: number;
  };
  priorities: Array<{
    area: string;
    title: string;
    evidence: string;
    interpretation: string;
    action: string;
    severity: ErrorSeverity;
  }>;
  strengths: string[];
  sessionPlan: string;
  routine: Array<{ step: number; title: string; duration: string; drill: string; goal: string }>;
  sideReview: {
    ctKills: number;
    ctDeaths: number;
    ctAdr: number;
    tKills: number;
    tDeaths: number;
    tAdr: number;
    verdict: string;
  };
  weaponVerdict: {
    strongWeapon: string;
    developWeapon: string;
    tip: string;
  };
  confidence: number;
};
export type ParseStatus = "idle" | "reading" | "parsing" | "ready" | "error";
export type PlayerIdentity = { steamid: string; name: string };
export type CoachEngine = "embedded" | "ollama";
export type CoachState = "unknown" | "checking" | "online" | "offline" | "thinking" | "released";
