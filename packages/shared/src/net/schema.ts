/**
 * Network schema shared by server and client (Colyseus Schema 5).
 * Kept apart from the sim so the sim core never depends on the network layer.
 *
 * Visibility: position, look and stance are public. Velocity and the sim's
 * internal timers are tagged `.view()` and only reach the owning client, which
 * needs them to reconcile its prediction. Other clients never see them.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerState = schema(
  {
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    yaw: t.float32(),
    pitch: t.float32(),
    crouch: t.uint8(),
    grounded: t.uint8(),
    vx: t.float32().view(),
    vy: t.float32().view(),
    vz: t.float32().view(),
    air: t.uint8().view(),
    jumpBuf: t.uint8().view(),
    prevButtons: t.uint8().view(),
    name: t.string(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const IslandState = schema(
  {
    seed: t.uint32(),
    /** Server tick counter, for the HUD and diagnostics. */
    tick: t.uint32(),
    players: t.map(PlayerState),
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
    buttons: t.uint8(),
    yaw: t.float32(),
    pitch: t.float32(),
  },
  'PlayerInput',
);
export type PlayerInput = SchemaType<typeof PlayerInput>;
