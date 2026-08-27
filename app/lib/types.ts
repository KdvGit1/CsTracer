export type Recommendation = { id: string; title: string; body: string; confidence: number };
export type MetricStatus = "measured" | "insufficient-sample" | "unavailable";
export type MetricQuality = {
  status: MetricStatus;
  sampleCount: number;
  methodVersion: string;
  reason?: string;
};
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
  adr: number | null; shots: number; movingShotPercent: number | null; movementSampleCount?: number;
  tradePercent: number | null; topZone: string | null; topZoneDeaths: number;
};
export type WeaponStat = {
  weapon: string; label: string; category?: string; kills: number; damage: number; shots: number; headshots: number;
  headshotPercent: number; movingShotPercent: number | null; movementSampleCount?: number;
  efficiency: number | null; score: number | null;
  status: "large-sample" | "measured" | "small-sample";
};
export type MovementCategoryStat = { shots: number; movingPercent: number };
export type MovementProfile = {
  averageSpeed: number; p90Speed: number; stableShots: number; microMoveShots: number;
  movingShots: number; fastMoveShots: number; stablePercent: number; microPercent: number;
  movingPercent: number; fastPercent: number; invalidShotPercent: number; severityScore: number;
  severity: "clean" | "minor" | "moderate" | "severe" | "unavailable";
  status: MetricStatus; sampleCount: number; unmeasuredShots: number;
  method: "weapon-max-speed-34pct-v1"; reason?: string;
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
  hitboxSampleCount?: number;
  accuracyPercent: number | null;
  earlyAccuracy: number | null;
  lateAccuracy: number | null;
  earlyShots: number;
  lateShots: number;
  status: MetricStatus;
  method: "bullet-damage-attack-tick-v1";
  reason?: string;
  hitboxCounts: { head: number; chest: number; stomach: number; arms: number; legs: number };
  hitboxPercents: { head: number; chest: number; stomach: number; arms: number; legs: number };
};
export type CrosshairStats = {
  headErrorAngle: number | null;
  bodyErrorAngle: number | null;
  headLevelRating: string;
  status: MetricStatus;
  sampleCount: number;
  method: "kill-tick-alignment-v2";
  reason?: string;
};
export type DuelStats = {
  averageTTD: number | null;
  medianTTD: number | null;
  ttdSampleCount?: number;
  preparedContacts?: number;
  unseenHits?: number;
  censoredContacts?: number;
  ttdMethod?: "spotted-to-first-damage-v2";
  ttdStatus: MetricStatus;
  ttdReason?: string;
  duelWinrate: number | null;
  duelWins: number;
  duelLosses?: number;
  duelTotal: number;
  duelMethod?: "mutual-spotted-death-v2";
  duelStatus: MetricStatus;
  duelReason?: string;
  fastReactions: number;
  reactionRating: string;
};
export type RoundEconomy = {
  round: number;
  startMoney: number | null;
  spentMoney: number | null;
  endMoney: number | null;
  buyType: string;
  status: MetricStatus;
};
export type EconomyStats = {
  averageStartMoney: number | null;
  totalCashSpent: number | null;
  roundEconomy: RoundEconomy[];
  ecoRounds: number;
  forceRounds: number;
  fullBuyRounds: number;
  status: MetricStatus;
  sampleCount: number;
  method: "round-freeze-money-v1";
  reason?: string;
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
  analysisVersion?: string;
  player: { name: string; steamid: string }; map: string; rounds: number; kills: number; deaths: number;
  assists: number; adr: number; headshotPercent: number; openingKills: number; openingDeaths: number;
  utilityDamage: number; enemyBlindSeconds: number; flashesThrown: number; shots: number;
  movingShotPercent: number | null; tradePercent: number | null; topZone: string; topZoneDeaths: number;
  unflashedDeaths: number; untradedDeaths: number; impact: number | null; deathDetails: DeathDetail[];
  kastPercent?: number | null; survivalPercent?: number | null; utilityImpactRoundPercent?: number | null; utilityImpactRoundSampleCount?: number;
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
    overallScore: number | null;
    grade: string;
    method: "kast-round-contribution-v1";
    sampleCount: number;
    impactScore: number | null;
    aimScore: number | null;
    movementScore: number | null;
    utilityScore: number | null;
    teamworkScore: number | null;
    positionScore: number | null;
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
    ctAdr: number | null;
    tKills: number;
    tDeaths: number;
    tAdr: number | null;
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
