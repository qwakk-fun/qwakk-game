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
    /** 1 when holding a gun it owns (battle royale ducks start unarmed). */
    armed: t.uint8(),
    /** Armor levels worn (drawn on the duck). */
    vest: t.uint8(),
    helmet: t.uint8(),
    /** Battle royale: finishing place once out (1 = winner), 0 while alive. */
    placement: t.uint8(),
    // Owner only from here on.
    /** Armor durability left. */
    vestDur: t.uint8().view(),
    helmetDur: t.uint8().view(),
    /** Damage dealt this match (results screen). */
    dealt: t.uint16().view(),
    /** Spectating: pid of the duck this (dead) player watches, 0 for none. */
    watch: t.uint16().view(),
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
    mode: t.uint8().view(),
    arms: t.uint8().view(),
    heal: t.uint16().view(),
    healKind: t.uint8().view(),
    bandages: t.uint8().view(),
    medkits: t.uint8().view(),
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
    /**
     * Movement mode (Mode.*: ground, freefall, glide) and action (0 idle, 1
     * reloading, 2 equipping, 3 healing), for drawing gliders and reloads. On the
     * pose, not the public player state, so they reach only viewers who get the
     * pose (culled like the position: a jump or a heal behind a wall stays hidden).
     */
    fly: t.uint8(),
    act: t.uint8(),
  },
  'Pose',
);
export type Pose = SchemaType<typeof Pose>;

export const MatchPhase = {
  Playing: 0,
  Intermission: 1,
  /** Battle royale: waiting for ducks before the room locks. */
  Warmup: 2,
  /** Battle royale: a winner is decided, results are up. */
  Ended: 3,
} as const;

export const GameMode = {
  Deathmatch: 0,
  BattleRoyale: 1,
} as const;

/** The safe circle. Clients interpolate the radius from the server clock. */
export const Zone = schema(
  {
    /** Phase index (ZONE.phases); 0 is the drop. */
    phase: t.uint8(),
    /** Current circle (at t0) and the target it shrinks to (at t1). */
    cx: t.float32(),
    cz: t.float32(),
    r: t.float32(),
    tx: t.float32(),
    tz: t.float32(),
    tr: t.float32(),
    /** Server time (ms since room start) the shrink starts and ends. Before t0 the circle is (cx, cz, r). */
    t0: t.uint32(),
    t1: t.uint32(),
    /** 1 once the next circle (tx, tz, tr) is announced. */
    shown: t.uint8(),
    /** Damage per second outside the circle right now. */
    dps: t.uint8(),
  },
  'Zone',
);
export type Zone = SchemaType<typeof Zone>;

/** A loot item lying in the world. Sent per viewer, only near items (StateView). */
export const LootItem = schema(
  {
    kind: t.uint8(),
    amount: t.uint16(),
    x: t.quantized({ min: -512, max: 512 }),
    y: t.quantized({ min: -64, max: 192 }),
    z: t.quantized({ min: -512, max: 512 }),
  },
  'LootItem',
);
export type LootItem = SchemaType<typeof LootItem>;

export const IslandState = schema(
  {
    /** GameMode: deathmatch or battle royale. */
    mode: t.uint8(),
    /** Map id ('greybox' or 'sainte-canard') and the hash of its files; the client refuses to play on a mismatch. */
    mapId: t.string(),
    mapHash: t.string(),
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
    // Battle royale.
    /** Ducks alive and ducks in the match. */
    alive: t.uint8(),
    total: t.uint8(),
    /** Plane: path index into the map's flight paths, and the server time it is at the path start; 0 when no plane. */
    planePath: t.uint8(),
    planeT0: t.uint32(),
    /** Server time the plane ejects everyone still aboard. */
    planeEnd: t.uint32(),
    zone: Zone,
    items: t.map(LootItem).view(),
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

/** Kill message weapon codes besides the WeaponIds. */
export const KillWeapon = {
  Zone: 3,
  Left: 4,
} as const;

/** Server to client messages. Arrays keep them small on the wire. */
export const Msg = {
  /** Batched shot effects for everyone but the shooter: [pid, weapon, outcome, mx,my,mz, ex,ey,ez][] */
  Shots: 'shots',
  /** To the shooter: [victimPid, damage, head(0/1), killed(0/1)] */
  HitConfirm: 'hit',
  /** To the victim: [directionMilliRad, damage, source] (source 0 a duck, 1 the zone; direction is the world angle toward the attacker). No position. */
  Damaged: 'dmg',
  /**
   * To everyone: [killerPid, victimPid, weapon, head(0/1), hasPos(0/1), victimX, victimY, victimZ] (cm).
   * The position only goes to viewers who could see the victim (anti-wallhack). killerPid 0: the zone.
   */
  Kill: 'kill',
  /** A shot the viewer cannot see: [weapon, directionMilliRad, loudness 0..2]; direction only, for audio. */
  ShotHint: 'sh',
  /** To the picker: [itemKind, amount] (feedback). */
  Picked: 'pk',
  /** To a player who is out or won: [placement, total, kills, damage, survivedMs]. */
  Result: 'res',
  /** Client to server: watch the next (1) or previous (-1) living duck while dead. */
  Spectate: 'spec',
} as const;
