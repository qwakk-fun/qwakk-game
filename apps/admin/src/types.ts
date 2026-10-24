/** Shapes of the admin API answers (apps/server/src/admin/api.ts and dashboard.ts). */

export interface RoomInfo {
  roomId: string;
  kind: 'dm' | 'br' | 'raid' | 'hub';
  label: string;
  mode: string;
  mapId: string;
  humans: number;
  bots: number;
  spectators: number;
  phase: string;
  secondsLeft: number;
  locked: boolean;
  maxHumans: number;
  tick: { avg: number; p95: number; max: number; samples: number };
  createdAt: number;
}

export interface RoomPlayer {
  sessionId: string;
  name: string;
  tag: string;
  playerId: string | null;
  bot: boolean;
  spectator: boolean;
  alive: boolean;
  kills: number;
  deaths: number;
  team: number;
  pingMs: number;
}

export interface Overview {
  at: string;
  players: { inGame: number; spectators: number; bots: number; connections: number; byRoomType: Record<string, number> };
  rooms: RoomInfo[];
  server: {
    tickAvgMs: number;
    tickP95Ms: number;
    tickMaxMs: number;
    cpuPct: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    loopDelayP99Ms: number;
    uptimeS: number;
    version: string;
    commit: string;
    node: string;
    db: string;
    persistent: boolean;
  };
  status: { banner: string | null; maintenance: boolean; maintenanceMessage: string | null };
}

export type SettingValue = number | boolean | string;

export interface Setting {
  key: string;
  group: 'dm' | 'dmBot' | 'br' | 'brBot' | 'raid' | 'weapons' | 'ops';
  label: string;
  help: string;
  kind: 'int' | 'number' | 'bool' | 'text';
  default: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  maxLength?: number;
  applies: 'now' | 'next-round' | 'new-rooms';
  env?: string;
  value: SettingValue;
  isDefault: boolean;
  lockedBy: string | null;
}

export interface SettingsData {
  settings: Setting[];
  presets: { dmBot: string; brBot: string };
  clientNumbers: { group: string; label: string; value: string }[];
  persistent: boolean;
}

export interface Ban {
  playerId: string;
  reason: string;
  expiresAt: number | null;
  createdAt: number;
  name: string | null;
  tag: string | null;
}

export interface IpBlock {
  id: number;
  masked: string;
  label: string;
  until: number;
  createdAt: number;
}

export interface PlayerRow {
  playerId: string;
  name: string;
  tag: string;
  createdAt: string;
  lastSeen: string;
  banned: boolean;
  hidden: boolean;
}

export interface HiddenPlayer {
  playerId: string;
  reason: string;
  createdAt: number;
  name: string | null;
  tag: string | null;
}

export interface BlockedWord {
  word: string;
  whole: boolean;
  createdAt: number;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  old: unknown;
  new: unknown;
}
