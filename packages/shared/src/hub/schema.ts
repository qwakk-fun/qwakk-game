/**
 * Network schema of the hub rooms (Duck Plaza), apart from the match schema
 * (PlayerState sits at Colyseus' field limit and carries combat state the hub
 * has none of).
 *
 * - `HubDuck` public fields: name, #tag, pid, look, level (0: a guest) and the
 *   team marker. Never a player id, token or address.
 * - The movement state (HUB_SIM_FIELDS) is `.view()`: only the owner gets it,
 *   to reconcile its prediction.
 * - Everyone else sees a duck through a quantized `HubPose` in `poses` (every
 *   tick, near) or `farPoses` (every third tick, farther), added per viewer by
 *   the hub interest (hub/interest.ts on the server); far away: nothing.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

export const HubDuck = schema(
  {
    name: t.string(),
    /** #tag from the session ('' for an unsigned dev duck). */
    tag: t.string(),
    pid: t.uint16(),
    /** The duck's look (characters.ts id). */
    character: t.uint8(),
    /** Account level (players.level, from the server's database), 0 for a guest. */
    level: t.uint8(),
    /** Team marker: ducks with the same nonzero number are in one party (a small per-room number, not the party code). */
    team: t.uint8(),
    // Owner only from here on: the movement state the owner reconciles.
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
  },
  'HubDuck',
);
export type HubDuck = SchemaType<typeof HubDuck>;

/** What other ducks see of a duck: position, facing, stance and its emote. */
export const HubPose = schema(
  {
    x: t.quantized({ min: -512, max: 512 }),
    y: t.quantized({ min: -64, max: 192 }),
    z: t.quantized({ min: -512, max: 512 }),
    yaw: t.angle(),
    pitch: t.quantized({ min: -1.6, max: 1.6, bits: 8 }),
    crouch: t.uint8(),
    grounded: t.uint8(),
    /** HubEmote.Dance while dancing, else 0 (the quack is a one-shot message). */
    emote: t.uint8(),
  },
  'HubPose',
);
export type HubPose = SchemaType<typeof HubPose>;

export const HubState = schema(
  {
    /** The hub map and the hash of its files (the client refuses to play on a mismatch). */
    mapId: t.string(),
    mapHash: t.string(),
    seed: t.uint32(),
    tick: t.uint32(),
    ducks: t.map(HubDuck),
    poses: t.map(HubPose).view(),
    farPoses: t.map(HubPose).view(),
  },
  'HubState',
);
export type HubState = SchemaType<typeof HubState>;
