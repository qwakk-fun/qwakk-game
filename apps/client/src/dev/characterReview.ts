/** Controlled character comparisons using the shipped map assets. Loaded only by mapview (dev/test). */
import * as THREE from 'three/webgpu';
import { createRenderer } from '../render/renderer.ts';
import { Avatar } from '../player/avatar.ts';
import { loadDuckGlb } from '../player/duckModel.ts';
import { loadClips } from '../player/animations.ts';
import { createSainteWorld, loadMapAssets } from '../world/sainte/index.ts';

export async function characterReview(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const { scene, camera, renderer } = await createRenderer(canvas, { forceWebGL: true, pixelRatio: 1, shadows: false });
  const assets = await loadMapAssets('sainte-canard');
  // A flat comparison stage uses the shipped terrain shader, textures and hedge
  // mesh, without unrelated buildings occluding a small target at 50 m.
  assets.def.terrain = { cells: 100, cellSize: 4, heights: new Float32Array(101 * 101).fill(5) };
  const hedgeName = assets.extras.props.find((p) => p.prop.includes('hedge'))!.prop;
  assets.extras.props = [];
  let world = await createSainteWorld(scene, assets, { quality: 'high', shadows: false });
  let lastBackground = '';
  const models = await Promise.all([loadDuckGlb(0), loadDuckGlb(1), loadClips()]);
  const ducks = [new Avatar(), new Avatar()];
  ducks.forEach((a, i) => { a.setModel(models[i] as THREE.Object3D); scene.add(a.object); });
  let draw = () => {};
  const review = {
    ready: true,
    async shot(background: string, distance: number, character: number, helmet = 0) {
      if (background !== lastBackground) {
        world.dispose();
        assets.ground = new Uint8Array(101 * 101).fill(assets.extras.groundLegend.indexOf(background === 'cobble' ? 'cobble' : 'grass'));
        assets.extras.props = background === 'hedge' ? [-4, 0, 4].map((x) => ({ prop: hedgeName, x, y: 5, z: -1, rotY: 0, scale: 1 })) : [];
        world = await createSainteWorld(scene, assets, { quality: 'high', shadows: false });
        lastBackground = background;
      }
      const [x, z] = [0, 2];
      const y = world.groundAt(x!, z!);
      // Looking slightly down keeps the named ground/hedge behind the whole silhouette.
      camera.position.set(x!, y + 1 + distance * 0.22, z! + distance);
      camera.lookAt(x!, y + 0.8, z!);
      camera.updateMatrixWorld();
      ducks.forEach((a, i) => {
        a.object.visible = character === 2 || character === i;
        const px = x! + (character === 2 ? (i - 0.5) * 2 : 0);
        a.update({ x: px, y: world.groundAt(px, z!), z: z!, yaw: Math.PI, pitch: 0, crouch: 0, grounded: true, alive: true, weapon: 0, act: 0, helmet }, 1 / 60);
        a.setDetail(distance);
      });
      draw = () => { world.update(camera, 0); world.env.follow(camera.position); renderer.render(scene, camera); };
      await renderer.compileAsync(scene, camera);
      draw();
      return { x: innerWidth / 2, y: innerHeight / 2, height: innerHeight * 1.9 / (2 * distance * Math.tan(camera.fov * Math.PI / 360)) };
    },
  };
  (window as unknown as { __characters: typeof review }).__characters = review;
  document.getElementById('info')!.hidden = true;
  renderer.setAnimationLoop(() => draw());
}
