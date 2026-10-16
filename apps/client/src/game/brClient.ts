/**
 * Battle royale on the client: the plane flyover and its camera, the drop
 * camera, loot in the world (brLoot.ts: items, crates and their lids) and the
 * pickup prompt, the inventory screen (brInventory.ts), the zone wall,
 * spectating after death, and the battle royale HUD (hud/br). Everything
 * here only draws what the server says; inputs still go through the normal
 * input path, and inventory requests are messages the server checks.
 */
import * as THREE from 'three/webgpu';
import {
  BR,
  choosePickup,
  circleAt,
  hasWeapon,
  HEAL,
  Item,
  ARMOR,
  capacityOf,
  isStack,
  loadOf,
  LOOT,
  Mode,
  OPAQUE_QUERY_GROUPS,
  overLand,
  planeAt,
  planeRoute,
  weaponStats,
  ZONE,
  type PlaneRoute,
  type PlayerSim,
} from '@qwakk/shared';
import { InvOp, MatchPhase, type LootItem } from '@qwakk/shared/net';
import { shortRoomId } from '@qwakk/shared/lobby';
import type { Sound } from '../audio/sound.ts';
import type { TpsCamera } from '../camera/tpsCamera.ts';
import { BrHud, type BoardRow, type BrHudData, type CratePanelView, type InventoryView } from '../hud/br/brHud.ts';
import type { InvAction } from '../hud/br/inventoryPanel.ts';
import { denyToast, itemLine, shortName } from '../hud/br/itemText.ts';
import { LobbyPanel } from '../hud/br/lobbyPanel.ts';
import { MapPainter, renderMapImage, type MapOverlay } from '../hud/br/mapCanvas.ts';
import type { GameHud } from '../hud/gameHud.ts';
import type { Controls } from '../input/controls.ts';
import type { Session } from '../net/session.ts';
import type { Avatar } from '../player/avatar.ts';
import type { RenderContext } from '../render/renderer.ts';
import { ItemsView, PlaneView, ZoneWall } from '../world/sainte/index.ts';
import type { WorldHandle } from '../world/worldHandle.ts';
import type { ExitSummary } from '../game.ts';
import { cratePanel, crateTitle, gearOf, inventoryScreen, promptNote } from './brInventory.ts';
import { LootClient, type LootEntry } from './brLoot.ts';

export interface BrDeps {
  ctx: RenderContext;
  session: Session;
  world: WorldHandle;
  controls: Controls;
  cam: TpsCamera;
  sound: Sound;
  ghud: GameHud;
  remoteAvatar(id: string): Avatar | null;
  exit(summary: ExitSummary): void;
}

interface ItemEntry {
  id: string;
  kind: number;
  amount: number;
  x: number;
  y: number;
  z: number;
}

/** What the dev autopilot may read (dev and test builds). */
export interface BrAutopilotView {
  inPlane: boolean;
  canJump: boolean;
  planeTime: number;
  items: ItemEntry[];
  promptId: string | null;
  /** The prompt's item does not fit (pressing E would do nothing). */
  promptBlocked: boolean;
  /** Test hook: go to this item first. */
  focus: string | null;
  /** Test hook: stand still once the prompt targets an open crate (screenshots of its contents). */
  holdOpen: boolean;
  zone: { x: number; z: number; r: number } | null;
  plane: { x: number; z: number } | null;
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

export class BrClient {
  private readonly d: BrDeps;
  private readonly plane: PlaneView;
  private readonly zoneWall: ZoneWall;
  private readonly items: ItemsView;
  private readonly hudView: BrHud;
  private readonly lobby: LobbyPanel;
  readonly loot: LootClient;
  private invOpen = false;
  /** Dev test hook: the autopilot goes to this item key first, and waits at an open crate (screenshots). */
  apFocus: string | null = null;
  apHoldOpen = false;
  private route: PlaneRoute | null = null;
  private routeKey = -1;
  private promptId: string | null = null;
  private outcome: { placement: number; total: number; kills: number; damage: number; survivedMs: number } | null = null;
  private watching = false;
  /** Stats for the test hook. */
  readonly stats = { picked: 0, denied: 0, itemsSeen: 0, jumped: false, landed: false, maxItems: 0, planeSeen: false, zoneWallSeen: false, placement: 0, resultShown: false, cratesOpened: 0, inventoryShown: false };
  private readonly tmp = new THREE.Vector3();
  private readonly half: number;

  constructor(d: BrDeps) {
    this.d = d;
    const scene = d.ctx.scene;
    this.plane = new PlaneView(scene);
    this.plane.visible = false;
    this.zoneWall = new ZoneWall(scene, (x, z) => d.world.groundAt(x, z));
    this.items = new ItemsView(scene);
    this.loot = new LootClient(this.items, d.world.sainte?.crates ?? null, {
      opened: (x, y, z) => d.sound.crateOpen(this.tmp.set(x, y + 0.5, z)),
      near: (x, z) => Math.hypot(x - d.ctx.camera.position.x, z - d.ctx.camera.position.z) < 70,
    });
    const map = d.world.map;
    this.half = map.size / 2;
    const assets = d.world.assets;
    const base = assets ? renderMapImage(map, assets.ground, assets.extras) : document.createElement('canvas');
    const labels = (map.br?.zones ?? []).filter((z) => z.poly.length > 2).map((z) => {
      let x = 0;
      let zz = 0;
      for (const [px, pz] of z.poly) {
        x += px;
        zz += pz;
      }
      return { name: z.name, x: x / z.poly.length, z: zz / z.poly.length };
    });
    this.hudView = new BrHud(d.ghud.element, new MapPainter(base, this.half), labels, {
      action: (a) => this.invAction(a),
      close: () => this.closeInventory(true),
    });
    this.lobby = new LobbyPanel(this.hudView.root);
  }

  /** Start listening to loot once the session is running. */
  attach(): void {
    this.d.session.watchItems(
      (id, it: LootItem) => {
        this.loot.add(id, it);
        this.stats.itemsSeen++;
        this.stats.maxItems = Math.max(this.stats.maxItems, this.loot.entries.size);
        this.stats.cratesOpened = this.loot.opened;
      },
      (id) => this.loot.remove(id),
    );
  }

  private get state() {
    return this.d.session.room.state;
  }

  private serverNow(): number {
    return this.d.session.room.clock.serverNow();
  }

  /** Seconds since the plane started its path (negative before), or NaN without a plane. */
  private planeTime(): number {
    const st = this.state;
    if (!st.planeT0) return Number.NaN;
    return (this.serverNow() - st.planeT0) / 1000;
  }

  private ensureRoute(): PlaneRoute | null {
    const st = this.state;
    if (!st.planeT0) return null;
    if (this.routeKey !== st.planePath) {
      this.routeKey = st.planePath;
      this.route = planeRoute(this.d.world.map, st.planePath);
    }
    return this.route;
  }

  private mySim(): PlayerSim | null {
    return (this.d.session.me?.state as unknown as PlayerSim | undefined) ?? null;
  }

  /**
   * Place the camera for battle royale states: orbiting the plane while
   * aboard, following the watched duck while dead. False: the normal camera.
   */
  placeCamera(dt: number, myPos: THREE.Vector3): boolean {
    const s = this.mySim();
    if (!s) return false;
    const c = this.d.controls;
    if (s.alive && s.mode === Mode.Plane) {
      const r = this.ensureRoute();
      if (!r) return false;
      // The same moment the plane is drawn at (it flies in from before its path start while boarding).
      const p = planeAt(r, Math.max(-5, this.planeTime()));
      this.d.cam.orbit(dt, p.x, p.y, p.z, c.yaw, Math.min(0.2, c.pitch));
      myPos.set(p.x, p.y, p.z);
      return true;
    }
    if (!s.alive && this.state.phase !== MatchPhase.Warmup) {
      const watchPid = this.d.session.mine?.watch ?? 0;
      const id = watchPid ? this.d.session.idOfPid(watchPid) : null;
      const pose = id ? this.d.session.pose(id) : null;
      if (pose && id) {
        this.watching = true;
        this.d.cam.setAirborne(pose.y > this.d.world.groundAt(pose.x, pose.z) + 4);
        this.d.cam.update(dt, pose.x, pose.y, pose.z, pose.crouch, pose.yaw, pose.pitch, false);
        myPos.set(pose.x, pose.y, pose.z);
        return true;
      }
      this.watching = false;
    }
    return false;
  }

  /** Per frame: plane, zone wall, items, prompt. */
  frame(dt: number, myPos: THREE.Vector3): void {
    const st = this.state;
    const r = this.ensureRoute();
    const t = this.planeTime();
    if (r && Number.isFinite(t) && t > -5 && t < r.length / r.speed + 8) {
      const p = planeAt(r, Math.max(-5, t));
      this.plane.visible = true;
      this.stats.planeSeen = true;
      this.plane.update(p.x, p.y, p.z, Math.atan2(r.dirX, r.dirZ), dt);
    } else this.plane.visible = false;

    const z = st.zone;
    if (z && st.planeT0) {
      const now = this.serverNow();
      const c = circleAt({ from: { x: z.cx, z: z.cz, r: z.r }, to: { x: z.tx, z: z.tz, r: z.tr }, t0: z.t0, t1: z.t1 }, now);
      this.zoneWall.set(c.x, c.z, c.r);
      if (c.r < 600) this.stats.zoneWallSeen = true;
      if (z.shown && z.tr < c.r - 0.5) this.zoneWall.setNext(z.tx, z.tz, z.tr);
      else this.zoneWall.setNext(0, 0, 0);
    } else this.zoneWall.set(0, 0, 10000);
    this.zoneWall.update(dt);

    this.updatePrompt(myPos);
    this.items.update(dt, this.d.ctx.camera);

    const s = this.mySim();
    if (this.invOpen && (!s || !s.alive || s.mode === Mode.Plane || st.phase !== MatchPhase.Playing || this.hudView.resultVisible)) this.closeInventory(false);
    if (s && s.mode !== Mode.Plane && st.phase === MatchPhase.Playing) this.stats.jumped = true;
    if (s && this.stats.jumped && s.mode === Mode.Ground && s.alive) this.stats.landed = true;
  }

  private updatePrompt(myPos: THREE.Vector3): void {
    const s = this.mySim();
    this.promptId = null;
    if (!s || !s.alive || s.mode !== Mode.Ground || this.state.phase !== MatchPhase.Playing) {
      this.items.highlight(null);
      return;
    }
    const cands: LootEntry[] = [];
    for (const e of this.loot.targets()) {
      if (Math.abs(e.x - s.x) < 3.5 && Math.abs(e.z - s.z) < 3.5 && this.reachable(s, e)) cands.push(e);
    }
    const yaw = this.d.controls.yaw;
    const pitch = this.d.controls.pitch;
    const cp = Math.cos(pitch);
    const pick = choosePickup(cands, s.x, s.y, s.z, -Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    this.promptId = pick?.key ?? null;
    this.items.highlight(this.promptId);
    void myPos;
  }

  /** Everything in pickup reach and sight right now (the inventory screen's left column). */
  private inReach(s: PlayerSim): LootEntry[] {
    const out: LootEntry[] = [];
    for (const e of this.loot.targets()) {
      if (Math.hypot(e.x - s.x, e.y + 0.15 - (s.y + 0.9), e.z - s.z) > LOOT.reach || !this.reachable(s, e)) continue;
      out.push(e);
    }
    out.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    return out;
  }

  get inventoryOpen(): boolean {
    return this.invOpen;
  }

  /** I: open the inventory screen (frees the mouse; movement keys still work), or close it. */
  toggleInventory(): void {
    if (this.invOpen) {
      this.closeInventory(true);
      return;
    }
    const s = this.mySim();
    if (!s || !s.alive || s.mode === Mode.Plane || this.state.phase !== MatchPhase.Playing || this.hudView.resultVisible) return;
    this.invOpen = true;
    this.stats.inventoryShown = true;
    this.d.controls.uiOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Close the inventory screen; `relock` takes the mouse back for play (needs a user gesture). */
  closeInventory(relock: boolean): void {
    if (!this.invOpen) return;
    this.invOpen = false;
    this.d.controls.uiOpen = false;
    this.hudView.showInventory(null);
    if (relock) this.d.controls.requestLock();
  }

  private invAction(a: InvAction): void {
    if (a.t === 'drop') this.d.session.inventory([InvOp.Drop, a.kind, a.amount]);
    else this.d.session.inventory([InvOp.Take, a.num, a.index, a.kind]);
  }

  /** Same line-of-sight rule as the server's pickup check (opaque geometry). */
  private reachable(s: PlayerSim, e: { x: number; y: number; z: number }): boolean {
    const sim = this.d.world.sim;
    const ey = s.y + (s.crouch ? 1.0 : 1.55);
    const tx = e.x - s.x;
    const ty = e.y + 0.2 - ey;
    const tz = e.z - s.z;
    const dist = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (dist < 0.05) return true;
    const hit = sim.world.castRay(new sim.rapier.Ray({ x: s.x, y: ey, z: s.z }, { x: tx / dist, y: ty / dist, z: tz / dist }), dist, true, undefined, OPAQUE_QUERY_GROUPS);
    return !hit || hit.timeOfImpact > dist - 0.25;
  }

  /** The results card is up (clicks go to its buttons, not to pointer lock). */
  get resultOpen(): boolean {
    return this.hudView.resultVisible;
  }

  /** The server closed a finished match: the card stays, without the watch button. */
  serverClosed(): void {
    if (!this.outcome) this.d.exit(this.summary());
  }

  toggleMap(): void {
    this.hudView.toggleMap();
  }

  spectate(dir: 1 | -1): void {
    if (this.hudView.resultVisible) return;
    this.d.session.spectate(dir);
  }

  /** A shot we cannot see: play it from its direction, at a distance by loudness. */
  shotHint(weapon: number, angle: number, loud: number, myPos: THREE.Vector3): void {
    const dist = loud === 2 ? 25 : loud === 1 ? 70 : 160;
    this.tmp.set(myPos.x - Math.sin(angle) * dist, myPos.y + 1.5, myPos.z - Math.cos(angle) * dist);
    this.d.sound.shot(weapon, this.tmp);
  }

  picked(kind: number, amount: number): void {
    this.stats.picked++;
    this.hudView.toast(isStack(kind) ? `+${amount} ${shortName(kind)}` : shortName(kind));
    this.d.sound.pickup();
  }

  /** The server said no to a pickup or an inventory request. */
  denied(reason: number, kind: number): void {
    const text = denyToast(reason, kind);
    if (!text) return;
    this.stats.denied++;
    this.hudView.toast(text, true);
    this.d.sound.deny();
  }

  result(placement: number, total: number, kills: number, damage: number, survivedMs: number): void {
    this.outcome = { placement, total, kills, damage, survivedMs };
    this.stats.placement = placement;
    this.stats.resultShown = true;
    this.closeInventory(false);
    if (document.pointerLockElement) document.exitPointerLock();
    const win = placement === 1;
    const killerName = this.killerName();
    this.hudView.showResult(
      { win, placement, total, kills, damage, survivedMs, killer: killerName },
      win ? null : () => this.d.controls.requestLock(),
      () => this.d.exit({ mode: 'br', placement, players: total, kills }),
    );
    if (win) this.d.sound.victory();
  }

  private killerName(): string {
    const pid = this.d.session.mine?.watch ?? 0;
    return pid ? (this.d.session.playerByPid(pid)?.name ?? '') : '';
  }

  /** Summary when leaving without a result (left mid-match). */
  summary(): ExitSummary {
    const r = this.outcome;
    return r ? { mode: 'br', placement: r.placement, players: r.total, kills: r.kills } : { mode: 'br', kills: this.d.session.mine?.kills ?? 0 };
  }

  private inventory(): InventoryView | null {
    const s = this.mySim();
    const mine = this.d.session.mine;
    if (!s || !mine) return null;
    const slot = (w: number) => ({
      has: hasWeapon(s, w),
      name: weaponStats(w).name,
      mag: w === 0 ? s.mag0 : s.mag1,
      res: w === 0 ? s.res0 : s.res1,
      active: s.weapon === w && hasWeapon(s, w),
    });
    return {
      slots: [slot(0), slot(1)],
      vest: mine.vest,
      vestPct: mine.vest ? mine.vestDur / (ARMOR.vestDurability[mine.vest] ?? 1) : 0,
      helmet: mine.helmet,
      helmetPct: mine.helmet ? mine.helmetDur / (ARMOR.helmetDurability[mine.helmet] ?? 1) : 0,
      bandages: s.bandages,
      medkits: s.medkits,
      pack: mine.pack,
      load: loadOf(s),
      capacity: capacityOf(gearOf(mine)),
    };
  }

  /** HUD, once per frame. */
  hud(dt: number, showBoard: boolean): void {
    const st = this.state;
    const s = this.mySim();
    const mine = this.d.session.mine;
    const now = this.serverNow();
    const r = this.ensureRoute();
    const t = this.planeTime();
    const z = st.zone;

    // Zone line and where it is.
    let zoneText = '';
    let outside = false;
    let current: { x: number; z: number; r: number } | null = null;
    let next: { x: number; z: number; r: number } | null = null;
    if (st.phase === MatchPhase.Warmup) zoneText = st.need > 0 ? `Waiting for ${st.need} more` : `Starting in ${clock(st.timeLeft)}`;
    else if (st.phase === MatchPhase.Ended) zoneText = 'Match over';
    else if (z && st.planeT0) {
      const c = circleAt({ from: { x: z.cx, z: z.cz, r: z.r }, to: { x: z.tx, z: z.tz, r: z.tr }, t0: z.t0, t1: z.t1 }, now);
      current = c.r < 1000 ? c : null;
      next = z.shown && z.tr < c.r - 0.5 ? { x: z.tx, z: z.tz, r: z.tr } : null;
      const shownAt = z.t0 - ((ZONE.phases[0]?.waitS ?? 0) - ZONE.firstShownS) * 1000;
      if (!z.shown) zoneText = `First zone in ${clock(Math.max(0, shownAt - now) / 1000)}`;
      else if (now < z.t0) zoneText = `Zone shrinks in ${clock((z.t0 - now) / 1000)}`;
      else if (now < z.t1) zoneText = `Zone closing ${clock((z.t1 - now) / 1000)}`;
      else zoneText = z.tr <= 0.5 ? 'Final zone' : 'Zone holding';
      if (s && s.alive && s.mode !== Mode.Plane && current && Math.hypot(s.x - c.x, s.z - c.z) > c.r) {
        outside = true;
        zoneText = `Outside the zone! ${zoneText}`;
      }
    }

    this.updateLobby();

    // Banner lines.
    let banner: string[] | null = null;
    let prompt: BrHudData['prompt'] = null;
    if (st.phase === MatchPhase.Warmup) {
      banner = this.waitingBanner();
    } else if (s && s.alive && s.mode === Mode.Plane && r) {
      const p = planeAt(r, Math.max(0, t));
      const land = t >= 0 && overLand(this.d.world.map, p.x, p.z);
      const auto = Math.max(0, r.ejectS - Math.max(0, t));
      banner = [t < 0 ? 'Boarding the plane' : land ? 'Over Sainte-Canard' : 'Over the sea', `Auto jump in ${clock(auto)}. Mouse to look around, M for the map.`];
      prompt = land ? { key: 'F', text: 'Jump' } : null;
    } else if (s && s.alive && s.mode === Mode.Freefall) {
      prompt = { key: 'Space', text: 'Open the glider (W to dive)' };
    } else if (s && s.alive && s.mode === Mode.Glide) {
      prompt = { key: 'W / S', text: 'Dive or brake' };
    } else if (s && !s.alive && this.watching && !this.hudView.resultVisible) {
      const pid = mine?.watch ?? 0;
      const name = pid ? (this.d.session.playerByPid(pid)?.name ?? '') : '';
      banner = [`Watching ${name}`, 'Click for the next duck. Esc, then Back to the pond, to leave.'];
    }
    let crate: CratePanelView | null = null;
    if (!prompt && this.promptId && s && mine) {
      const e = this.loot.entries.get(this.promptId);
      if (e && e.kind === Item.Crate && !e.open) prompt = { key: 'E', text: `Open the ${crateTitle(e).toLowerCase()}` };
      else if (e && e.kind === Item.Crate) {
        prompt = { key: 'E', text: 'Take all', alt: { key: 'I', text: 'Pick items' } };
        crate = cratePanel(s, mine, e);
      } else if (e) {
        const note = promptNote(s, mine, e);
        prompt = { key: 'E', text: itemLine(e.kind, e.amount, e.extra), ...(note ? { note } : {}) };
      }
    }

    const heal = s && s.heal > 0 ? { name: s.healKind === 2 ? 'Medkit' : 'Bandage', progress: 1 - s.heal / (s.healKind === 2 ? HEAL.medkitTicks : HEAL.bandageTicks) } : null;
    const inv = this.inventory();
    const myX = s && s.mode !== Mode.Plane ? s.x : r ? planeAt(r, Math.max(0, t)).x : 0;
    const myZ = s && s.mode !== Mode.Plane ? s.z : r ? planeAt(r, Math.max(0, t)).z : 0;
    const zoneTarget = next ?? current;
    const zoneAngle = zoneTarget && s && Math.hypot(myX - zoneTarget.x, myZ - zoneTarget.z) > zoneTarget.r ? Math.atan2(-(zoneTarget.x - myX), -(zoneTarget.z - myZ)) : null;
    const pp = r ? planeAt(r, Math.max(0, t)) : null;
    const showPlane = r && pp && Number.isFinite(t) && (s?.mode === Mode.Plane || t < r.ejectS + 5);
    const overlay: MapOverlay = {
      me: s ? { x: myX, z: myZ, yaw: this.d.controls.yaw } : null,
      zone: current,
      next,
      plane: showPlane ? { fx: r.fromX, fz: r.fromZ, tx: r.fromX + r.dirX * r.length, tz: r.fromZ + r.dirZ * r.length, px: pp.x, pz: pp.z } : null,
    };
    this.hudView.update(
      dt,
      {
        zoneText,
        outside,
        alive: st.alive,
        kills: mine?.kills ?? 0,
        yaw: this.d.controls.yaw,
        zoneAngle,
        inv: st.phase === MatchPhase.Warmup ? null : inv,
        heal,
        prompt,
        crate: this.invOpen ? null : crate,
        banner,
      },
      overlay,
      this.half,
    );
    this.hudView.showInventory(this.invOpen && s && mine ? inventoryScreen(s, mine, this.inReach(s)) : null);
    if (showBoard && !this.invOpen) {
      const rows: BoardRow[] = [];
      for (const [id, p] of st.players) rows.push({ name: p.name, kills: p.kills, alive: p.alive === 1, placement: p.placement, me: id === this.d.session.sessionId, bot: p.bot });
      this.hudView.showBoard(rows, inv);
    } else this.hudView.showBoard(null, null);
  }

  /** Dev autopilot input. */
  autopilotView(): BrAutopilotView {
    const s = this.mySim();
    const r = this.ensureRoute();
    const t = this.planeTime();
    const p = r ? planeAt(r, Math.max(0, t)) : null;
    const z = this.state.zone;
    const mine = this.d.session.mine;
    const prompt = this.promptId ? this.loot.entries.get(this.promptId) : undefined;
    return {
      inPlane: s?.mode === Mode.Plane,
      canJump: !!p && t >= 0 && overLand(this.d.world.map, p.x, p.z),
      planeTime: t,
      items: [...this.loot.targets()].map((e) => ({ id: e.key, kind: e.kind, amount: e.amount, x: e.x, y: e.y, z: e.z })),
      promptId: this.promptId,
      promptBlocked: !!(prompt && s && mine && promptNote(s, mine, prompt)),
      focus: this.apFocus,
      holdOpen: this.apHoldOpen && prompt?.kind === Item.Crate && prompt.open,
      zone: z && z.shown ? { x: z.tx, z: z.tz, r: z.tr } : null,
      plane: p ? { x: p.x, z: p.z } : null,
    };
  }

  /** Waiting room: the big line is who we wait for, or the countdown. */
  private waitingBanner(): string[] {
    const st = this.state;
    const n = st.players.size;
    const ducks = (k: number): string => `${k} ${k === 1 ? 'duck' : 'ducks'}`;
    if (st.need > 0) return [`Waiting for ${st.need} more ${st.need === 1 ? 'duck' : 'ducks'}`, `${ducks(n)} in. The countdown starts at ${n + st.need}. Damage is off.`];
    return [`The plane leaves in ${clock(st.timeLeft)}`, `${ducks(n)} in. More can join. Bots fill the empty seats.`];
  }

  /** The waiting room panel: room name and who is in (only before the match starts). */
  private updateLobby(): void {
    const st = this.state;
    if (st.phase !== MatchPhase.Warmup) {
      this.lobby.update(null);
      return;
    }
    const me = this.d.session.sessionId;
    const players = [...st.players.entries()]
      .filter(([, p]) => !p.bot)
      .sort(([, a], [, b]) => a.pid - b.pid)
      .map(([id, p]) => ({ name: p.name, tag: p.tag, me: id === me }));
    this.lobby.update({ label: st.label, shortId: shortRoomId(this.d.session.room.roomId), cap: BR.players, players });
  }

  dispose(): void {
    this.lobby.dispose();
    this.closeInventory(false);
    this.loot.clear();
    this.hudView.dispose();
    this.plane.dispose();
    this.zoneWall.dispose();
    this.items.clear();
    this.items.group.removeFromParent();
  }
}
