import * as THREE from 'three/webgpu';
import { DM, DmPower, compareDmResults, dmAccuracy, TICK_RATE, type DmReward, type DmKillcam, type SimWorld } from '@qwakk/shared';
import { MatchPhase } from '@qwakk/shared/net';
import type { Session } from '../net/session.ts';
import type { Sound } from '../audio/sound.ts';
import type { GameHud } from '../hud/gameHud.ts';
import { t } from '../i18n/game.ts';
import { DeathReplay } from './deathReplay.ts';
import '../hud/dm.css';

const powerName = (kind: number): string => t(kind === DmPower.Speed ? 'Speed boost' : kind === DmPower.Armor ? 'Armor boost' : 'High jump');
const weaponName = (kind: number): string => t(kind === 0 ? 'Rifle' : 'Pistol');
const esc = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Mode-specific presentation; every reward and result comes from authoritative state. */
export class DmClient {
  readonly replay: DeathReplay;
  private readonly replayLabel = document.createElement('span');
  private readonly root = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly rewards = document.createElement('div');
  private readonly mvp = document.createElement('section');
  private readonly ribbon = document.createElement('div');
  private readonly powerGroup = new THREE.Group();
  private readonly pickups = new Map<string, THREE.Group>();
  private rewardTimers = new Set<ReturnType<typeof setTimeout>>();
  private resultKey = '';
  private lastRotation = -1;
  private warned = false;
  private wasIntermission = false;

  private readonly session: Session;
  private readonly sound: Sound;
  private readonly hud: GameHud;

  constructor(session: Session, sound: Sound, hud: GameHud, scene: THREE.Scene, sim: SimWorld) {
    this.replay = new DeathReplay(sim);
    this.session = session; this.sound = sound; this.hud = hud;
    this.root.className = 'dm-hud';
    this.status.className = 'dm-status';
    this.rewards.className = 'dm-rewards';
    this.rewards.setAttribute('aria-live', 'polite');
    this.mvp.className = 'dm-mvp';
    this.mvp.hidden = true;
    this.ribbon.className = 'dm-replay';
    this.ribbon.hidden = true;

    const skip = document.createElement('button');
    skip.textContent = t('Skip · Space');
    skip.onclick = () => this.replay.clear();
    this.ribbon.append(this.replayLabel, skip);
    this.root.append(this.status, this.rewards, this.mvp, this.ribbon);
    hud.element.append(this.root);
    scene.add(this.powerGroup);
    window.addEventListener('keydown', this.skip);
  }

  private skip = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && this.replay.active && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
      this.replay.clear();
    }
  };

  killcam(replay: DmKillcam): void {
    const mine = this.session.mine;
    if (!mine || replay.victimId !== this.session.sessionId || replay.victimLife !== mine.life || this.session.room.state.phase !== MatchPhase.Playing) return;
    this.replayLabel.textContent = t('Killcam · {name}', { name: this.session.room.state.players.get(replay.killerId)?.name ?? '?' });
    this.replay.start(performance.now(), replay);
  }

  reward(reward: DmReward): void {
    const labels = [reward.kill ? t('Elimination') : '', reward.head ? t('Headshot') : '', reward.revenge ? t('Revenge') : ''].filter(Boolean);
    const title = reward.milestone ? t('{n} KILL STREAK', { n: reward.milestone }) : labels.shift() ?? '';
    this.toast(title, `+${reward.points} ${t('points')}${labels.length ? ` · ${labels.join(' · ')}` : ''}`, reward.milestone ? 'streak' : reward.head ? 'head' : '');
    if (reward.milestone || reward.revenge) this.sound.reward(reward.milestone);
    else if (reward.head) this.sound.headshot();
  }

  power(kind: number): void {
    this.toast(powerName(kind), t('{n} seconds · replaces your current boost', { n: DM.powerDurationSeconds }), 'power');
    this.sound.reward();
  }

  private toast(title: string, detail: string, kind: string): void {
    const item = document.createElement('div');
    item.className = `dm-reward ${kind}`;
    const strong = document.createElement('strong'), sub = document.createElement('span');
    strong.textContent = title;
    sub.textContent = detail;
    item.append(strong, sub);
    this.rewards.append(item);
    while (this.rewards.children.length > 2) this.rewards.firstElementChild?.remove();
    const timer = setTimeout(() => { item.remove(); this.rewardTimers.delete(timer); }, kind === 'streak' ? 3000 : 2000);
    this.rewardTimers.add(timer);
  }

  private clearRewards(): void {
    for (const timer of this.rewardTimers) clearTimeout(timer);
    this.rewardTimers.clear();
    this.rewards.replaceChildren();
  }

  /** Creates at most three small, labeled world pickups. Geometry uses the existing renderer. */
  frame(now: number): void {
    const state = this.session.room.state;
    this.powerGroup.visible = !this.replay.active;
    for (const [id, group] of this.pickups) {
      if (!state.dmPickups.has(id)) { this.disposePickup(group); this.pickups.delete(id); }
    }
    for (const [id, pickup] of state.dmPickups) {
      let group = this.pickups.get(id);
      if (!group) {
        group = new THREE.Group();
        const color = pickup.kind === DmPower.Speed ? 0x67e8b0 : pickup.kind === DmPower.Armor ? 0x79baff : 0xd2a6ff;
        const material = new THREE.MeshBasicNodeMaterial({ color });
        const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), material);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 24), material);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -0.45;
        group.add(orb, ring);
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#151619'; context.fillRect(0, 0, 256, 64);
        context.fillStyle = '#ffffff'; context.font = 'bold 24px sans-serif'; context.textAlign = 'center';
        context.fillText(powerName(pickup.kind), 128, 41);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: texture }));
        label.position.y = 0.7; label.scale.set(1.8, 0.45, 1);
        group.add(label);
        this.powerGroup.add(group);
        this.pickups.set(id, group);
      }
      group.position.set(pickup.x, pickup.y + Math.sin(now / 450 + Number(id)) * 0.08, pickup.z);
      group.children[0]!.rotation.y = now / 700;
    }
  }

  hudFrame(): void {
    const state = this.session.room.state, mine = this.session.mine;
    const intermission = state.phase === MatchPhase.Intermission;
    if (intermission !== this.wasIntermission) {
      this.replay.clear();
      this.clearRewards();
      this.resultKey = '';
      this.wasIntermission = intermission;
    }
    this.ribbon.hidden = !this.replay.active;
    this.hud.element.classList.toggle('dm-replaying', this.replay.active);
    this.hud.element.classList.toggle('dm-intermission', intermission);
    this.status.hidden = intermission || this.replay.active;
    const boost = mine && mine.dmPowerTicks > 0 ? ` · ${powerName(mine.dmPower)} ${Math.ceil(mine.dmPowerTicks / TICK_RATE)}s${mine.dmPower === DmPower.Armor ? ` (${Math.ceil(mine.dmShield)})` : ''}` : '';
    this.status.textContent = `${t('{n} points · Streak {streak}', { n: mine?.dmPoints ?? 0, streak: mine?.dmStreak ?? 0 })}${boost}\n${t('{weapon} · rotation in {n}s', { weapon: weaponName(state.dmWeapon), n: state.dmRotationLeft })}`;
    if (!intermission && state.dmRotationLeft > 0) {
      if (this.lastRotation >= 0 && this.lastRotation !== state.dmWeapon) {
        this.toast(t('Weapon rotation'), weaponName(state.dmWeapon), 'power');
        this.sound.reward();
        this.warned = false;
      }
      if (state.dmRotationLeft <= DM.rotationWarningSeconds && !this.warned) {
        this.toast(t('Weapon rotation'), t('{weapon} in {n}s', { weapon: weaponName(state.dmWeapon === 0 ? 1 : 0), n: state.dmRotationLeft }), 'power');
        this.warned = true;
      }
      if (state.dmRotationLeft > DM.rotationWarningSeconds) this.warned = false;
      this.lastRotation = state.dmWeapon;
    }
    this.mvp.hidden = !intermission;
    if (!intermission) return;
    const rows = [...state.dmResults.values()].sort(compareDmResults);
    const key = JSON.stringify(rows) + state.timeLeft;
    if (key === this.resultKey) return;
    this.resultKey = key;
    const mvp = rows[0];
    const streak = [...rows].sort((a, b) => b.bestStreak - a.bestStreak || compareDmResults(a, b))[0];
    const accuracy = rows.filter((r) => r.shots >= DM.accuracyMinShots).sort((a, b) => b.hits / b.shots - a.hits / a.shots || b.shots - a.shots)[0];
    const me = rows.find((r) => r.pid === mine?.pid);
    const card = (label: string, name: string, value: string) => `<div class="dm-award"><small>${esc(label)}</small><strong>${esc(name)}</strong><span>${esc(value)}</span></div>`;
    this.mvp.innerHTML = `<small>${t('ROUND HIGHLIGHTS')}</small><h2>${t('MVP')}</h2><p>${state.winner ? t('{name} wins', { name: esc(state.winner) }) : t('Time is up')}</p><div class="dm-awards">${card(t('Most points'), mvp?.name ?? '—', mvp ? `${mvp.points} ${t('points')}` : '—')}${card(t('Best streak'), streak?.name ?? '—', String(streak?.bestStreak ?? 0))}${card(t('Best accuracy'), accuracy?.name ?? '—', accuracy ? `${dmAccuracy(accuracy)}% · ${accuracy.hits}/${accuracy.shots}` : t('At least {n} shots', { n: DM.accuracyMinShots }))}</div>${me ? `<p class="dm-personal">${t('Your round')}: ${me.points} ${t('points')} · ${me.kills}/${me.deaths} K/D · ${dmAccuracy(me)}% ${t('accuracy')} · ${t('Best streak')} ${me.bestStreak}</p>` : ''}<p>${t('Next round in {n}', { n: state.timeLeft })}</p>`;
  }

  private disposePickup(group: THREE.Group): void {
    group.removeFromParent();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          (material as THREE.MeshBasicNodeMaterial).map?.dispose();
          material.dispose();
        }
      }
    });
  }

  dispose(): void {
    this.replay.clear();
    this.clearRewards();
    window.removeEventListener('keydown', this.skip);
    for (const group of this.pickups.values()) this.disposePickup(group);
    this.pickups.clear();
    this.powerGroup.removeFromParent();
    this.root.remove();
  }
}
