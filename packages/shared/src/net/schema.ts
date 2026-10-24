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
    /** Deathmatch bonus score and current/best life streak. */
    dmPoints: t.uint32(),
    dmStreak: t.uint16(),
    dmBestStreak: t.uint16(),
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
    /** uint32: the Hunt Season skill buttons live past bit 15 (input.ts). */
    prevButtons: t.uint32().view(),
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
    dmPower: t.uint8().view(),
    dmPowerTicks: t.uint16().view(),
    dmShield: t.float32().view(),
    /**
     * Deathmatch kill stacks and the hero bit, packed (dmBuffs.ts). Public: it
     * draws the aura and the cape on ducks a viewer receives, and holds no
     * position or movement state. PlayerState is near Colyseus' 63 field limit.
     */
    dmBuff: t.uint8(),
    /** Hero flight energy (ticks), owner only: thrust on or off is movement state. */
    dmEnergy: t.uint8().view(),
    /**
     * Deathmatch explosives, owner only, packed into one field (explosives.ts: grenades, rockets, the
     * launcher in hand, both gates). This schema is near its limit of 64 fields: pack new sim state too.
     */
    ex: t.uint32().view(),
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
    /** Deathmatch: 1 while the duck holds the rocket launcher (drawn in place of the rifle). Culled with the pose. */
    lnch: t.uint8(),
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
  /** Hunt Season, the co-op PvE mode (raid/). */
  Raid: 2,
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

/** Public map objectives, never player positions. */
export const DmPickup = schema({ kind: t.uint8(), x: t.float32(), y: t.float32(), z: t.float32() }, 'DmPickup');
export type DmPickup = SchemaType<typeof DmPickup>;

/** Frozen round-end statistics, also available to late spectators. */
export const DmRoundRow = schema({
  pid: t.uint16(), name: t.string(), points: t.uint32(), kills: t.uint16(), deaths: t.uint16(),
  bestStreak: t.uint16(), shots: t.uint32(), hits: t.uint32(),
}, 'DmRoundRow');
export type DmRoundRow = SchemaType<typeof DmRoundRow>;

/**
 * Hunt Season: one of the keep's bread cannons as everyone sees it: who mans
 * it (pid, 0 for nobody), where its barrel points, its heat and when it may
 * fire next. Public to the room (every duck in a run is on the same side).
 */
export const RaidCannon = schema(
  {
    pid: t.uint16(),
    yaw: t.angle(),
    pitch: t.quantized({ min: -1.6, max: 1.6, bits: 8 }),
    /** 0 to 255 of the overheat limit; `hot` 1 while it cools down from an overheat (no firing). */
    heat: t.uint8(),
    hot: t.uint8(),
    /** Server time (ms since room start) it may fire again. */
    ready: t.uint32(),
  },
  'RaidCannon',
);
export type RaidCannon = SchemaType<typeof RaidCannon>;

/**
 * Hunt Season: the run as everyone in it sees it (stage, wave, the core, the
 * gate, the drawbridge, the boss, the cannons). Public to the room (every
 * duck in a run is on the same side).
 */
export const RaidState = schema(
  {
    /** RaidStage: lobby, break, fight, won, lost. */
    stage: t.uint8(),
    /** The wave being fought, or the one coming after a break (1 to waves); 0 in the lobby. */
    wave: t.uint8(),
    waves: t.uint8(),
    /** Server time (ms since room start) the lobby countdown or the break ends; 0 when nothing counts down. */
    ends: t.uint32(),
    /** Server time the current wave started (the HUD's wave timer). */
    waveAt: t.uint32(),
    /** The QoreChain core in the courtyard: the run is lost when it falls. */
    coreHp: t.uint16(),
    coreMax: t.uint16(),
    /** The main gate: health and its look (GateState: intact, damaged, broken). */
    gateHp: t.uint16(),
    gateMax: t.uint16(),
    gate: t.uint8(),
    /** The drawbridge (BridgeState), the server times its current move started and ends, when the lever may be pulled again, and when a raised bridge comes down by itself (0: not up). */
    bridge: t.uint8(),
    bridgeAt: t.uint32(),
    bridgeEnds: t.uint32(),
    leverReady: t.uint32(),
    bridgeDown: t.uint32(),
    /** Hunters still to beat this wave (alive and still to come). */
    left: t.uint16(),
    /** The Big Hunter's health bar (0 and 0 while none is out). */
    bossHp: t.uint16(),
    bossMax: t.uint16(),
    /** Ducks in the run, and hunters bagged by the whole team. */
    ducks: t.uint8(),
    kills: t.uint16(),
    /** The bread cannons, keyed by their index ('0' to '3'). */
    cannons: t.map(RaidCannon),
    /** v3, the push: the objective in play (Goal, push.ts), where its marker stands, and how far along it is (done of need). `wave` is its number, `waves` the count. */
    goal: t.uint8(),
    gx: t.float32(),
    gz: t.float32(),
    gDone: t.uint16(),
    gNeed: t.uint16(),
  },
  'RaidState',
);
export type RaidState = SchemaType<typeof RaidState>;

/**
 * One hunter or dog (raid/hunters.ts). Sent to everyone in the room, every
 * tick, regardless of line of sight: hunters are AI enemies of a co-op mode,
 * not opponents, so seeing them gives no human an edge over another (the
 * CLAUDE.md Hunt Season rule). Quantized like a duck's pose.
 */
export const Hunter = schema(
  {
    /** HunterKind. */
    kind: t.uint8(),
    x: t.quantized({ min: -512, max: 512 }),
    y: t.quantized({ min: -64, max: 192 }),
    z: t.quantized({ min: -512, max: 512 }),
    yaw: t.angle(),
    pitch: t.quantized({ min: -1.6, max: 1.6, bits: 8 }),
    /** HunterAct: what it does (animation, the aim laser, the boss wind-up). */
    act: t.uint8(),
    /** Health left, 0 to 255 of its full health (the small bar over it). */
    hp: t.uint8(),
    /** HunterFx bits (raid/hunters.ts): an elite (the ring under it). */
    fx: t.uint8(),
  },
  'Hunter',
);

/**
 * Hunt Season v3: an objective's marker in the field (a supply crate to
 * smash, a watchtower to take, the Big Hunter's camp). Public like the
 * hunters. `hp` is 0 to 255 of a crate's health; `done` 1 once taken.
 */
export const RaidTarget = schema(
  { kind: t.uint8(), x: t.float32(), y: t.float32(), z: t.float32(), hp: t.uint8(), done: t.uint8() },
  'RaidTarget',
);
export type RaidTarget = SchemaType<typeof RaidTarget>;
export type Hunter = SchemaType<typeof Hunter>;

/** A trapper's trap on the ground: armed (1) once it can catch, sprung (2) with a duck in it. */
export const RaidTrap = schema({ x: t.float32(), y: t.float32(), z: t.float32(), state: t.uint8() }, 'RaidTrap');
export type RaidTrap = SchemaType<typeof RaidTrap>;

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
    // Deathmatch.
    dmPickups: t.map(DmPickup),
    dmResults: t.map(DmRoundRow),
    dmWeapon: t.uint8(),
    dmRotationLeft: t.uint16(),
    /** Health a hero gets (admin setting, read when a hero is made): the hero's health bar. */
    dmHeroHp: t.uint8(),
    /** The rocket launcher pickup (at most one): a public map objective like `dmPickups` (kind unused). */
    dmRockets: t.map(DmPickup),
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
    // Hunt Season.
    raid: RaidState,
    hunters: t.map(Hunter),
    traps: t.map(RaidTrap),
    /** Ammo and heal drops (kind RaidDrop), public like the deathmatch boosts. */
    raidDrops: t.map(DmPickup),
    /** v3 objective markers (crates, towers, the camp). */
    raidTargets: t.map(RaidTarget),
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
    /** Button bits (input.ts); uint32 since the Hunt Season skill buttons (bits 16 to 18). */
    buttons: t.uint32(),
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
  /** Deathmatch explosives (also the weapon of their Msg.ShotHint). */
  Grenade: 6,
  Rocket: 7,
  /** Hunt Season: a hunter did it; the hunter's kind is added (HunterBase + HunterKind). */
  HunterBase: 10,
} as const;

/** Server to client messages. Arrays keep them small on the wire. */
export const Msg = {
  /** Batched shot effects for everyone but the shooter: [pid, weapon, outcome, mx,my,mz, ex,ey,ez][] */
  Shots: 'shots',
  /** To the shooter: [victimPid, damage, head(0/1), killed(0/1), knocked(0/1), explosive(0/1, optional)] */
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
  /** To the earning player only: DmReward, computed from verified server combat. */
  DmReward: 'dm-reward',
  /** To the collector only: DmPower kind. */
  DmPower: 'dm-power',
  /** Server to the dead victim only: DmKillcam. No client request handler. */
  DmKillcam: 'dm-killcam',
  /**
   * To everyone: [DmHeroEvent, heroPid, otherPid]. Chosen (other 0), took the
   * cape from `otherPid`, or lost (heroPid: the old hero; nobody holds it).
   * No position.
   */
  DmHero: 'dm-hero',
  /**
   * To everyone but the hero, every DM_HERO.pingEverySeconds: [heroPid, x, z],
   * the hero's position rounded to a DM_HERO.pingGrid meter grid. A deliberate,
   * public mode objective (CLAUDE.md anti-wallhack exception), never a pose.
   */
  DmHeroPing: 'dm-hero-ping',
  /**
   * Deathmatch explosives in flight: [id, kind, ownerPid, x, y, z, vx, vy, vz] (cm, cm/s; kind ExplosiveKind).
   * Only to viewers who see the thrower (and the thrower); everyone else in earshot gets a Msg.ShotHint
   * (KillWeapon.Grenade or Rocket, direction only). A grenade at rest is also shown, with ownerPid 0 and no
   * velocity, to viewers who see its spot: it never leads back to a hidden thrower.
   */
  Proj: 'pj',
  /**
   * An explosion, public within earshot: [id, kind, x, y, z] (cm). No thrower: a blast never names or
   * places who caused it. `id` ends the projectile of that id, if the client draws it.
   */
  Boom: 'boom',
  /** To the collector only: the rocket launcher with this many rockets. */
  DmRocket: 'dm-rocket',
  /**
   * Hunt Season, to one duck: its upgrade cards [deadlineServerMs, id, value, id, value, id, value]
   * (values are the server's numbers, for the card text). An empty array closes the cards.
   */
  RaidOffer: 'raid-offer',
  /** Client to server: the card it picks (0, 1 or 2). The server checks it against the offer. */
  RaidPick: 'raid-pick',
  /** To one duck: its own run state [maxHp, damagePct, armorPct, regenPerS, revivePct, headPct, lifesteal, kills, xpSoFar, ...upgradeIdsTaken]. */
  RaidSelf: 'raid-self',
  /** To everyone: [hunterKind, killerPid, head(0/1), x, y, z (cm), how (RaidKillHow)]: a hunter bagged. */
  RaidKill: 'raid-kill',
  /** To everyone (some kinds to one duck): [RaidEvent, a, b]: wave start or clear, the whistle, the core and the gate, the drawbridge, a duck caught. */
  RaidEvent: 'raid-ev',
  /**
   * To one duck at the run end: [reason (RaidEndReason), wavesCleared, kills, bossKills, revives, xpGained,
   * xpBefore, xpAfter, levelBefore, levelAfter, runMs, bestWave, bestMs, newBest(0/1), granted (0: the first, unsaved answer; 1: stored; 2: could not be saved),
   * feathersGained (the run's Tüy, with the daily bonus once stored), feathersBefore, feathersAfter (-1 until stored), dailyBonus].
   */
  RaidEnd: 'raid-end',
  /**
   * To one duck: what its katana (or pistol) did to hunters this tick, for the damage numbers and the combo:
   * [combo, stormMeter, n, then n times: damage, RaidHitFlags, x, y, z (cm)]. The server's numbers; never a duck's.
   */
  RaidHits: 'raid-hits',
  /**
   * Hunt Season, to one duck when it joins (and again when a test hook changes it): what it brought to this run,
   * from the server's database (never from the client): [level, unlockBits (unlocks.ts SKILL_BIT), katanaTier,
   * armorTier, bladeDamagePct, critChancePct, bonusHp, damageStoppedPct]. The client masks the skill buttons its
   * unlock bits do not hold before it sends and predicts (everything is locked until this arrives).
   */
  RaidKit: 'raid-kit',
  /**
   * Hunt Season, to everyone in the run: the looks of every duck's gear [pid, katanaTier, armorTier, ...]
   * (cosmetic: the blade's tint, the vest band; every duck in a run is an ally).
   */
  RaidLooks: 'raid-looks',
} as const;

/** `Msg.RaidHits` flags per hit. */
export const RaidHitFlags = {
  Crit: 1,
  /** From behind. */
  Back: 2,
  Killed: 4,
  Elite: 8,
  /** Dealt by a dash, the quack, the storm, bleeding or the chain (not the swing itself). */
  Skill: 16,
  /** A supply crate, not a hunter. */
  Crate: 32,
} as const;

/** `Msg.RaidEvent` kinds. */
export const RaidEvent = {
  /** [_, objective number, Goal]: an objective starts (v2: a wave). */
  GoalStart: 1,
  /** [_, objective number, 0]: an objective is taken. */
  GoalClear: 2,
  /** [_, x, z] (m): the Big Hunter whistles for help. */
  Whistle: 3,
  /** [_, coreHp, 0]: hunters at the QoreChain core (throttled). */
  CoreHit: 4,
  /** [_, duckPid, 0]: a duck stepped in a trap. */
  Trapped: 5,
  /** [_, 0, 0]: the core repair kit was used. */
  CoreRepaired: 6,
  /** [_, gateHp, GateState]: hunters at the gate (throttled). */
  GateHit: 7,
  /** [_, 0, 0]: the gate broke, hunters can get in. */
  GateBroken: 8,
  /** [_, duckPid, 0]: a broken gate was repaired enough to hold again. */
  GateFixed: 9,
  /** [_, BridgeState (Raising or Lowering), duckPid (0: by itself)]: the drawbridge starts to move. */
  Bridge: 10,
  /** [_, hunters, duckPid]: hunters on the bridge went into the moat. */
  Splash: 11,
  /** To one duck: [_, LeverDenied reason, seconds]: the lever did not move. */
  LeverDenied: 12,
  /** To one duck: [_, cannon index, 0]: the cannon it mans overheated. */
  Overheat: 13,
  /** To one duck: [_, hunters, 0]: several hunters bagged in quick succession (a multi-kill call-out). */
  Streak: 14,
  /** [_, target kind, 0]: an objective marker was taken (a crate smashed, a tower cleared). */
  TargetDone: 15,
} as const;

/** Why a lever pull did nothing (`RaidEvent.LeverDenied`). */
export const LeverDenied = {
  Cooldown: 1,
  /** A duck stands on the deck: the bridge does not rise under it. */
  DuckOnBridge: 2,
  Moving: 3,
} as const;

/** How a hunter was bagged (`Msg.RaidKill`, last field). */
export const RaidKillHow = {
  Shot: 0,
  /** Into the moat when the drawbridge rose. */
  Splash: 1,
  /** A bread loaf. */
  Bread: 2,
  /** The katana (a slash or the heavy spin). */
  Blade: 3,
  /** A dash through it, the quack shockwave, the Blade Storm, bleeding. */
  Skill: 4,
} as const;

/** Hunt Season drops (`raidDrops` kind). */
export const RaidDrop = {
  Ammo: 1,
  Heal: 2,
} as const;

/** `Msg.DmHero` events. */
export const DmHeroEvent = {
  Chosen: 1,
  Took: 2,
  Lost: 3,
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
