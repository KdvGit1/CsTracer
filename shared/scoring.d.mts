export const SCORE_METHOD: "kast-round-contribution-v1";

export type DirectScoreDimensions = {
  aim: number | null;
  movement: number | null;
  utility: number | null;
  teamwork: number | null;
  position: number | null;
  roundImpact: number | null;
};

export type DirectMatchScore = {
  overall: number | null;
  grade: string;
  method: typeof SCORE_METHOD;
  sampleCount: number;
  dimensions: DirectScoreDimensions;
};

export function kastContributionGrade(value: unknown): string;
export function scoreMatchReport(report: unknown): DirectMatchScore | null;
