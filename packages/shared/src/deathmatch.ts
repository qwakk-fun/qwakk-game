/** Deathmatch-only rewards and temporary effects. Kill stacks and the hero cape (dmBuffs.ts) reset on death. */
export const DM = {
  killPoints: 100,
  headHitPoints: 10,
  headKillPoints: 50,
  revengePoints: 50,
  streakPoints: { 3: 50, 5: 100, 10: 200 } as Readonly<Record<number, number>>,
  powerEverySeconds: 20,
  powerLifetimeSeconds: 25,
  powerDurationSeconds: 10,
  powerMax: 3,
  powerRadius: 1.7,
  speedMultiplier: 1.15,
  jumpMultiplier: 1.2,
  shieldHp: 25,
  armorReduction: 0.25,
  rotationSeconds: 60,
  rotationWarningSeconds: 5,
  replaySeconds: 2.5,
  replayHz: 12,
  accuracyMinShots: 10,
} as const;

export const DmPower = { None: 0, Speed: 1, Armor: 2, Jump: 3 } as const;

export interface DmReward {
  points: number;
  total: number;
  streak: number;
  milestone: number;
  head: boolean;
  revenge: boolean;
  kill: boolean;
  /** The victim was the caped hero (bonus points included in `points`; the killer takes the cape). */
  hero?: boolean;
}

export interface DmStats {
  points: number;
  streak: number;
  bestStreak: number;
  shots: number;
  hits: number;
  lastKiller: string | null;
}

export function freshDmStats(): DmStats {
  return { points: 0, streak: 0, bestStreak: 0, shots: 0, hits: 0, lastKiller: null };
}

export interface DmResult {
  pid: number;
  name: string;
  points: number;
  kills: number;
  deaths: number;
  bestStreak: number;
  shots: number;
  hits: number;
}

export function dmAccuracy(s: Pick<DmStats, 'shots' | 'hits'>): number {
  return s.shots > 0 ? Math.round(100 * Math.min(s.hits, s.shots) / s.shots) : 0;
}

/** Stable podium order. The round's existing kill limit stays separate from bonus points. */
export function compareDmResults(a: DmResult, b: DmResult): number {
  return b.points - a.points || b.kills - a.kills || a.deaths - b.deaths || a.pid - b.pid;
}

/** A bounded, server-recorded killcam, delivered only to the dead victim. */
export interface DmReplayPose {
  x: number; y: number; z: number; yaw: number; pitch: number; crouch: number;
  grounded: boolean; alive: boolean; weapon: number; act: number; aim: number;
}
export interface DmKillcam {
  killerId: string;
  victimId: string;
  victimLife: number;
  frames: { at: number; killer: DmReplayPose; victim: DmReplayPose }[];
}
