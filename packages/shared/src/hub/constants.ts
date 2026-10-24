/**
 * Duck Plaza (map id `duck-plaza`), the social hub between matches: every
 * tunable number of the hub rooms, the client hub scene and the hub
 * messages. No combat in the hub: ducks walk, jump, chat, quack, dance,
 * team up and walk through the portals into the game modes.
 */

export const HUB = {
  /** Colyseus room name. Quick Play (joinOrCreate) fills the fullest open hub first so people meet. */
  roomName: 'hub',
  mapId: 'duck-plaza',
  /** Ducks per hub room, and hub rooms open at once (one server instance). */
  maxClients: 40,
  maxRooms: 40,
  /**
   * Interest (bandwidth only: there is no combat, so no line-of-sight culling).
   * Ducks within `near` meters are sent every tick, within `far` every
   * `farEveryTicks` ticks, beyond that not at all. The `*Out` radii are the
   * hysteresis for leaving a class.
   */
  near: 20,
  nearOut: 24,
  far: 70,
  farOut: 78,
  farEveryTicks: 3,
  /** Re-classify the pairs every this many ticks. */
  interestEveryTicks: 6,
  /**
   * Plaza movement: every ground speed of the shared sim (walk 2.6, run 5.2,
   * sprint 7.0 and crouch 2.3 m/s in MOVE) times this, so getting around the
   * square is quick: walk 3.5, run 7.0, sprint 9.5 m/s. Part of the hub's
   * sim world on both sides (`applyHubMovement`), so prediction stays exact;
   * jumps, gravity and the match modes are unchanged.
   */
  moveScale: 1.35,
  /** A duck below this height (fell through) or outside the map goes back to a spawn. */
  minY: -20,
  /** After a portal answer the duck is not sent another for this long (ms). */
  portalCooldownMs: 3000,
  /** After the portal said "go", the duck is leaving: no further portal answers for this long (ms). */
  portalLeaveMs: 15000,
  /** Invites: a token bucket per sender, how long an invite stays open, the same target again only after a while. */
  invite: {
    burst: 3,
    refillMs: 5000,
    ttlMs: 20000,
    sameTargetMs: 6000,
    /** An invite needs the other duck within this distance (m) on the server. */
    maxDistance: 45,
  },
  /** Linking a new party: the inviter's client must join the party the hub opened within this time (ms). */
  partyLinkMs: 12000,
  /** Emotes: a token bucket per duck; a dance lasts this long unless the duck walks off. */
  emote: {
    burst: 3,
    refillMs: 1200,
    danceMs: 8000,
    /** A dance stops when the duck moves faster than this (m/s). */
    danceStopSpeed: 1.5,
  },
  /** Team markers refresh from the party registry every this many ticks. */
  teamEveryTicks: 15,
  /** Client: name tags and level badges within this range (m), fading from `labelFade`. */
  labelRange: 32,
  labelFade: 20,
  /** Client: chat bubbles above a duck stay this long (ms), and the fading log keeps this many lines. */
  bubbleMs: 6500,
  logLines: 5,
  logMs: 14000,
  /** Client: the player may click a duck within this distance (m). */
  pickRange: 40,
} as const;

/** Hub room messages. Arrays keep them small; nothing in them is a player id, token or address. */
export const HubMsg = {
  /** Client to server: invite the duck with this pid to your team: [pid]. Rate limited and checked on the server. */
  Invite: 'h-inv',
  /** Server to the invited duck: [fromPid, fromName, fromTag]. */
  Invited: 'h-invd',
  /** Client to server: answer an invite: [fromPid, 1 accept / 0 decline]. */
  Answer: 'h-ans',
  /** Server to one duck: a short notice [HubNote, pid (0: none), portal index or 0]. */
  Note: 'h-note',
  /** Server to one duck: join the party with this code ({ code }): the hub opened it, or the inviter's. */
  Party: 'h-party',
  /** Client to server: an emote [HubEmote]. Rate limited. */
  Emote: 'h-emo',
  /** Server to the ducks that see the quacker (and itself): [pid]. */
  Quack: 'h-quack',
  /** Server to one duck: it walked into a portal it may take: [portal index]. The client then joins that mode. */
  Portal: 'h-portal',
} as const;

/** `HubMsg.Note` kinds. */
export const HubNote = {
  InviteSent: 1,
  Declined: 2,
  Expired: 3,
  TeamFull: 4,
  /** The invited duck already has an open invite, or is leaving through a portal. */
  Busy: 5,
  /** Too many invites (or emotes) in a short time. */
  Limited: 6,
  /** Already on the same team. */
  Teammates: 7,
  /** A portal this duck may not take: guests play Deathmatch only (sign in). */
  Locked: 8,
  /** A team member who is not the leader: the leader picks the game. */
  LeaderPicks: 9,
  /** The team has a guest: Battle Royale and Hunt Season need every duck signed in. */
  PartyGuest: 10,
  /** The invited duck joined your team. */
  Joined: 11,
  /** Linking the team failed (try again). */
  Failed: 12,
  /** The duck is too far away to invite. */
  TooFar: 13,
} as const;

export const HubEmote = {
  Quack: 1,
  Dance: 2,
} as const;

/** The portals in wire order (index on the wire): the mode each one opens. */
export const PORTALS = ['dm', 'br', 'raid'] as const;
export type PortalId = (typeof PORTALS)[number];

/** Portals a guest may not take (they need an account; the game servers refuse a guest anyway). */
export const ACCOUNT_PORTALS: readonly PortalId[] = ['br', 'raid'];

export function isPortalId(v: unknown): v is PortalId {
  return typeof v === 'string' && (PORTALS as readonly string[]).includes(v);
}

/**
 * The walk-through trigger of a portal arch (plaza_portal, glTF space: the
 * opening is 4.2 m wide and the arch 1.6 m deep). A duck's feet inside this
 * box enter the portal.
 */
export const PORTAL_TRIGGER = {
  halfWidth: 1.75,
  halfDepth: 0.55,
  below: 1.0,
  above: 3.2,
} as const;

/**
 * The market stalls of Fountain Square that sell Hunt Season gear (Tüy only,
 * docs/progression.md): the Blacksmith (katanas) and the Armorer (armor).
 * Positions are the map's `plaza_stall` props (gen_plaza.py; a test checks
 * they match); each faces east, its counter on that side. A duck within
 * `SHOP_RANGE` of the spot `SHOP_FRONT` meters in front of the counter may
 * open the shop panel (E, or a tap). Opening it is a client affordance only:
 * every purchase is a checked server request (`/api/duck`).
 */
export const HUB_SHOPS = [
  { id: 'smith', slot: 'katana', x: -12, y: 3, z: 23, yaw: Math.PI / 2 },
  { id: 'armorer', slot: 'armor', x: -12, y: 3, z: 30, yaw: Math.PI / 2 },
] as const;

export type ShopId = (typeof HUB_SHOPS)[number]['id'];

export const SHOP_FRONT = 1.9;
export const SHOP_RANGE = 2.4;

/** Where a duck stands to shop at a stall (in front of its counter). */
export function shopSpot(id: ShopId): { x: number; z: number } {
  const s = HUB_SHOPS.find((x) => x.id === id) ?? HUB_SHOPS[0];
  return { x: s.x + Math.sin(s.yaw) * SHOP_FRONT, z: s.z + Math.cos(s.yaw) * SHOP_FRONT };
}

/** The stall a duck at (x, z) can shop at, or null. */
export function shopAt(x: number, z: number): ShopId | null {
  for (const s of HUB_SHOPS) {
    const p = shopSpot(s.id);
    if (Math.hypot(x - p.x, z - p.z) <= SHOP_RANGE) return s.id;
  }
  return null;
}
