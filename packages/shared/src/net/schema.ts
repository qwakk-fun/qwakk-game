/**
 * Network schema shared by server and client (Colyseus Schema 5).
 * Kept apart from the sim so the sim core never depends on the network layer.
 *
 * Visibility:
 * - `PlayerState` public fields (name, score, alive, weapon) go to everyone.
 * - The full sim state (exact position, velocity, ammo, timers) and hp are
 *   tagged `.view()` and reach only the owning client, which needs them to
 *   reconcile its prediction.
 * - Everyone else sees a player through a quantized `Pose`: `poses` (every
 *   tick) for players nearby, `farPoses` (every third tick) for players far
 *   away. Both maps are `.view()`, so the server picks per viewer which entry,
 *   if any, each client receives (interest management).
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerState = schema(
  {
    name: t.string(),
    /** Small numeric id: seeds spread, labels the scoreboard. */
    pid: t.uint16(),
    bot: t.boolean(),
    kills: t.uint16(),
    deaths: t.uint16(),
    alive: t.uint8(),
    weapon: t.uint8(),
    /** 1 while spawn protection is on. */
    protect: t.uint8(),
    /** 0 idle, 1 reloading, 2 equipping (for remote animation). */
    act: t.uint8(),
    // Owner only from here on.
    hp: t.uint8().view(),
    /** Respawn counter and spawn facing: the client turns its camera to `spawnYaw` when `life` changes. */
    life: t.uint16().view(),
    spawnYaw: t.float32().view(),
    x: t.float32().view(),
    y: t.float32().view(),
    z: t.float32().view(),
    vx: t.float32().view(),
    vy: t.float32().view(),
    vz: t.float32().view(),
    yaw: t.float32().view(),
    pitch: t.float32().view(),
    crouch: t.uint8().view(),
    grounded: t.uint8().view(),
    air: t.uint8().view(),
    jumpBuf: t.uint8().view(),
    prevButtons: t.uint16().view(),
    equip: t.uint8().view(),
    cooldown: t.uint8().view(),
    reload: t.uint8().view(),
    mag0: t.uint8().view(),
    mag1: t.uint8().view(),
    res0: t.uint8().view(),
    res1: t.uint8().view(),
    spray: t.float32().view(),
    shotSeq: t.uint16().view(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** What other clients see of a player: about 9 bytes per update. */
export const Pose = schema(
  {
    x: t.quantized({ min: -512, max: 512 }),
    y: t.quantized({ min: -64, max: 192 }),
    z: t.quantized({ min: -512, max: 512 }),
    yaw: t.angle(),
    pitch: t.quantized({ min: -1.6, max: 1.6, bits: 8 }),
    crouch: t.uint8(),
    grounded: t.uint8(),
  },
  'Pose',
);
export type Pose = SchemaType<typeof Pose>;

export const MatchPhase = {
  Playing: 0,
  Intermission: 1,
} as const;

export const IslandState = schema(
  {
    seed: t.uint32(),
    /** Server tick counter, for the HUD and diagnostics. */
    tick: t.uint32(),
    phase: t.uint8(),
    /** Seconds left in the round, or until the next round during intermission. */
    timeLeft: t.uint16(),
    scoreLimit: t.uint8(),
    /** Name of the last round's winner (shown during intermission). */
    winner: t.string(),
    players: t.map(PlayerState),
    poses: t.map(Pose).view(),
    farPoses: t.map(Pose).view(),
  },
  'IslandState',
);
export type IslandState = SchemaType<typeof IslandState>;

/**
 * One input frame on the wire. The framework assigns the sequence number
 * (InputHandle.send returns it, the server acks it), so it is not a field.
 */
export const PlayerInput = schema(
  {
    tick: t.uint32(),
    mx: t.float32(),
    mz: t.float32(),
    buttons: t.uint16(),
    yaw: t.float32(),
    pitch: t.float32(),
    /** Server time (ms) the client was drawing other players at: the lag-compensation rewind target. */
    vt: t.uint32(),
  },
  'PlayerInput',
);
export type PlayerInput = SchemaType<typeof PlayerInput>;

/** Server to client messages. Arrays keep them small on the wire. */
export const Msg = {
  /** Batched shot effects for everyone but the shooter: [pid, weapon, outcome, mx,my,mz, ex,ey,ez][] */
  Shots: 'shots',
  /** To the shooter: [victimPid, damage, head(0/1), killed(0/1)] */
  HitConfirm: 'hit',
  /** To the victim: [attackerX, attackerZ, damage] */
  Damaged: 'dmg',
  /** To everyone: [killerPid, victimPid, weapon, head(0/1), victimX, victimY, victimZ] */
  Kill: 'kill',
} as const;
