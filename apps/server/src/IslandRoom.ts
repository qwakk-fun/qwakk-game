/**
 * The deathmatch room on the greybox island: networking glue (gameRoom.ts)
 * around the Deathmatch rules. Kept on the greybox arena (simpler, and the
 * Phase 1 tests and benchmark stay comparable); the battle royale room plays
 * Sainte-Canard.
 */
import type { Client } from '@colyseus/core';
import { INTEREST, ROOM } from '@qwakk/shared';
import { recordMatch } from './meta/index.ts';
import { GameMode, MatchPhase, Msg } from '@qwakk/shared/net';
import { Deathmatch, DEFAULT_DM, type Seat } from './deathmatch.ts';
import { GameRoom, type GameRoomOptions } from './gameRoom.ts';
import { greybox, type ServerMap } from './maps.ts';

export type IslandRoomOptions = GameRoomOptions;

export class IslandRoom extends GameRoom<Deathmatch> {
  override maxClients: number = ROOM.maxClients;
  private roundStartedAt = Date.now();

  protected loadMap(options: GameRoomOptions): ServerMap {
    return greybox((options.seed ?? ROOM.defaultSeed) >>> 0);
  }

  protected createMatch(options: GameRoomOptions): Deathmatch {
    this.state.mode = GameMode.Deathmatch;
    this.state.scoreLimit = DEFAULT_DM.scoreLimit;
    return new Deathmatch(
      this.sim,
      {
        ...DEFAULT_DM,
        bots: options.bots !== false,
        isFar: (viewer, target, now, rtt) => this.interest.isFarAt(viewer, target, now, rtt),
        farExtraDelayMs: INTEREST.farExtraDelayMs,
      },
      {
        shot: (shooter, weapon, r) => this.queueShot(shooter, weapon, r),
        hit: (shooter, victim, damage, head, killed) => this.clients.getById(shooter.id)?.send(Msg.HitConfirm, [victim.pid, damage, head ? 1 : 0, killed ? 1 : 0]),
        damaged: (victim, from, damage) => this.sendDamaged(victim, from, damage),
        kill: (killer, victim, weapon, head) => this.sendKill(killer, victim, weapon, head),
        roundEnd: () => this.recordRound(),
        roundStart: () => (this.roundStartedAt = Date.now()),
      },
    );
  }

  protected addHuman(client: Client, name: string): Seat {
    return this.match.addHuman(client.sessionId, name);
  }

  protected removeHuman(id: string): void {
    this.match.remove(id);
  }

  protected override onSpectatorJoin(): void {
    this.match.allowBotsAlone = true;
    this.match.fillBots();
  }

  protected override onSpectatorLeave(): void {
    this.match.allowBotsAlone = this.spectators.size > 0;
    this.match.fillBots();
  }

  protected matchEndTick(): void {
    this.match.endTick();
  }

  protected writeMatchState(): void {
    const st = this.state;
    const dm = this.match;
    st.phase = dm.phase === 'playing' ? MatchPhase.Playing : MatchPhase.Intermission;
    st.timeLeft = dm.secondsLeft;
    if (st.winner !== dm.winner) st.winner = dm.winner;
  }

  /** A deathmatch round counts for the leaderboard too (placement by kills). */
  private recordRound(): void {
    const seats = [...this.match.seats.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    if (!seats.some((s) => !s.bot)) return;
    void recordMatch({
      matchId: `${this.roomId}-${this.roundStartedAt}`,
      mode: 'dm',
      mapId: this.state.mapId,
      startedAt: this.roundStartedAt,
      endedAt: Date.now(),
      players: seats.map((s, i) => ({
        playerId: s.bot ? null : (this.seatPlayerIds.get(s.id) ?? null),
        name: s.name,
        isBot: s.bot !== null,
        placement: i + 1,
        kills: s.kills,
        damage: s.dealt,
        survivedMs: Date.now() - this.roundStartedAt,
        deaths: s.deaths,
      })),
    });
  }
}
