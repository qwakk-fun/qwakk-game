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
    /** Guest #tag from the player's session ('' for bots and unsigned dev guests). */
    tag: t.string(),
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
    /** Backpack level worn (drawn on the duck; sets the owner's carrying capacity). */
    pack: t.uint8(),
    /** Battle royale: finishing place once out (1 = winner), 0 while alive. Team modes: the team's place. */
    placement: t.uint8(),
    /**
     * Team number (0: none). Battle royale team modes: the duck's team; a
     * deathmatch: the party's ally group. Public (who plays with whom is no
     * secret); where a duck is stays culled for enemies.
     */
    team: t.uint8(),
    /** The duck the player picked (`characters.ts` id; bots get one too). Looks only, public. */
    character: t.uint8(),
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
    /** Aim down sights ramp (ticks), owner only: others see it as the pose action. */
    aim: t.uint8().view(),
    /** 1 while knocked (owner only: teammates read it from `mates`, enemies see the pose action). */
    down: t.uint8().view(),
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
     * Movement mode (Mode.*: ground, freefall, glide) and action (`Act`: 0 idle,
     * 1 reloading, 2 equipping, 3 healing, 4 aiming down sights), for drawing
     * gliders, reloads and raised guns. On the
     * pose, not the public player state, so they reach only viewers who get the
     * pose (culled like the position: a jump or a heal behind a wall stays hidden).
     */
    fly: t.uint8(),
    act: t.uint8(),
  },
  'Pose',
);
export type Pose = SchemaType<typeof Pose>;

/**
 * A teammate as the HUD shows it: health (or the bleed meter while knocked)
 * and the revive in progress. One entry per duck that has a team, added only
 * to the views of its teammates (StateView), never to enemies.
 */
export const TeamMate = schema(
  {
    pid: t.uint16(),
    hp: t.uint8(),
    alive: t.uint8(),
    down: t.uint8(),
    /** Revive progress 0..255 while a teammate revives it, and that teammate's pid. */
    rev: t.uint8(),
    rby: t.uint16(),
  },
  'TeamMate',
);
export type TeamMate = SchemaType<typeof TeamMate>;

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

/**
 * A loot item lying in the world, or a crate. Sent per viewer, only near and
 * seen items (StateView, br/itemViews.ts). Each version of an item is its own
 * entry, so these fields never change after the entry is added.
 */
export const LootItem = schema(
  {
    kind: t.uint8(),
    amount: t.uint16(),
    x: t.quantized({ min: -512, max: 512 }),
    y: t.quantized({ min: -64, max: 192 }),
    z: t.quantized({ min: -512, max: 512 }),
    /** A loose item's magazine (guns) or durability (armor), when it carries its own (extraFrom); 0 otherwise. */
    ex: t.uint8(),
    /** 1 when `ex` is set (a dropped item), 0 for an item as new. */
    exk: t.uint8(),
    /** Crates: Container.* of a map crate (1 small, 2 large, 3 ammo box), 0 for a dead duck's crate. */
    box: t.uint8(),
    /** Crates: map loot point id + 1 (0: not a map crate). The client draws the map's crate prop there. */
    pt: t.uint16(),
    /** Crates: 1 once opened (server decides; a map crate stays open). */
    open: t.uint8(),
    /** Crates: the contents, only once open (packContents). Nobody learns what a closed crate holds. */
    c: t.string(),
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
    /** Lobby room name (roomLabel) and, while waiting, how many more humans the countdown needs. */
    label: t.string(),
    need: t.uint8(),
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
    /** Battle royale team size (1 solo, 2 duo, 4 squad) and teams still in the match. */
    teamSize: t.uint8(),
    teams: t.uint8(),
    /** Teammates for the HUD, keyed by seat id: each client gets only its own team's entries. */
    mates: t.map(TeamMate).view(),
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
  /** A knocked duck whose team has nobody standing, or that bled out. */
  Bleed: 5,
} as const;

/** Server to client messages. Arrays keep them small on the wire. */
export const Msg = {
  /** Batched shot effects for everyone but the shooter: [pid, weapon, outcome, mx,my,mz, ex,ey,ez][] */
  Shots: 'shots',
  /** To the shooter: [victimPid, damage, head(0/1), killed(0/1), knocked(0/1)] */
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
  /**
   * To a player who is out or won: [placement, total, kills, damage, survivedMs, teamSize].
   * Team modes: the team's place among `total` teams, sent once the team is out (or won).
   */
  Result: 'res',
  /** To everyone: [attackerPid, victimPid, weapon, head(0/1)]: a duck was knocked (team modes). No position. */
  Knock: 'knk',
  /** Client to server: watch the next (1) or previous (-1) living duck while dead. */
  Spectate: 'spec',
  /** To the picker: [Deny reason, itemKind] when a Use press or an inventory request did nothing. */
  Denied: 'no',
  /**
   * Client to server, a request the server checks (battle royale): [InvOp.Drop, itemKind, amount]
   * or [InvOp.Take, entityNumber, contentIndex (-1: the item itself), itemKind].
   */
  Inv: 'inv',
  /** To everyone in a game room: a short notice from the server operators (text, shown as a HUD toast). */
  Notice: 'ntc',
  /** Client sends text only; the server supplies the sender's public identity. */
  Chat: 'chat',
  /** To the sender only: the chat cooldown has not expired. */
  ChatLimited: 'chat-limit',
} as const;

/** Plain room chat. No positions, device identities or tokens. */
export interface ChatMessage {
  pid: number;
  name: string;
  tag: string;
  text: string;
}

/** Inventory requests (Msg.Inv). */
export const InvOp = {
  Drop: 1,
  Take: 2,
} as const;
