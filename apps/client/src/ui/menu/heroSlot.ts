/**
 * The Play tab's duck: the static image paints with the menu, then the 3D duck
 * that aims at the cursor (src/menuHero, loaded by a function main.ts hands
 * in, so this folder never imports it) takes over. Stays on the image when the
 * viewer prefers reduced motion or saves data, when 3D fails, and while a game
 * runs (stop() frees the 3D duck before the game starts; start() brings it back).
 */

/** What src/menuHero/index.ts exports (kept as a type here: no import from the menu). */
export interface HeroModule {
  mountHero(
    host: HTMLElement,
    opts?: { onLost?: () => void; cancelled?: () => boolean; character?: string },
  ): Promise<{ setActive(on: boolean): void; setCharacter(id: string): void; dispose(): void }>;
}

type Handle = Awaited<ReturnType<HeroModule['mountHero']>>;

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = (): boolean => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

export class HeroSlot {
  private readonly host: HTMLElement;
  private readonly load: (() => Promise<HeroModule>) | undefined;
  private handle: Handle | null = null;
  /** Bumped by stop(): a mount that resolves after it is thrown away. */
  private gen = 0;
  private running = false;
  private failed = false;
  private active = true;
  /** The picked duck (menu catalog id): the model the 3D duck shows. */
  private character: string;

  constructor(host: HTMLElement, load?: () => Promise<HeroModule>, character = 'classic') {
    this.host = host;
    this.load = load;
    this.character = character;
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      if (e.matches) this.stop();
    });
  }

  start(): void {
    if (!this.load || this.running || this.failed || reducedMotion() || saveData()) return;
    this.running = true;
    const gen = this.gen;
    const load = this.load;
    void (async () => {
      try {
        const mod = await load();
        if (gen !== this.gen) return;
        const handle = await mod.mountHero(this.host, {
          onLost: () => {
            if (this.handle === handle) this.handle = null;
            this.running = false;
            this.failed = true;
          },
          cancelled: () => gen !== this.gen,
          character: this.character,
        });
        if (gen !== this.gen) return handle.dispose();
        this.handle = handle;
        handle.setActive(this.active);
        handle.setCharacter(this.character); // picked again while it loaded
      } catch (err) {
        if (gen !== this.gen) return;
        // No WebGL2 or the models did not load: the image stays.
        console.warn('[menu] 3D duck unavailable, keeping the image', err);
        this.running = false;
        this.failed = true;
      }
    })();
  }

  /** Free the 3D duck (the image shows again). */
  stop(): void {
    this.gen++;
    this.running = false;
    this.handle?.dispose();
    this.handle = null;
  }

  /** Swap the 3D duck's model (it keeps showing the old one until the new one is ready). */
  setCharacter(id: string): void {
    this.character = id;
    this.host.classList.remove('is-3d');
    this.handle?.setCharacter(id);
    if (!this.handle && !this.running) {
      this.failed = false;
      this.start();
    }
  }

  setActive(on: boolean): void {
    this.active = on;
    this.handle?.setActive(on);
  }
}
