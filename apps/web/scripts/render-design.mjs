#!/usr/bin/env node
/** Deterministic, local-only six-camera rendering of an actual generated GLB. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const threeRoot = resolve(dirname(require.resolve('three')), '..');
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
if (!args.includes('--input') || !args.includes('--output')) throw new Error('Expected --input request.json --output result.json');
const request = JSON.parse(await readFile(flag('--input'), 'utf8'));
const asset = resolve(request.scene_asset_path);
if ((await stat(asset)).size > 100 * 1024 * 1024) throw new Error('Render asset exceeds 100 MB');
const outputDir = resolve(request.output_dir);
await mkdir(outputDir, { recursive: true });
const width = Math.max(256, Math.min(2048, request.width ?? 1024));
const height = Math.max(256, Math.min(2048, request.height ?? 1024));
const html = `<!doctype html><html><head><style>body{margin:0}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
try {
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(${width},${height});renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;
document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#eef1f5');
scene.add(new THREE.HemisphereLight('#ffffff','#627085',2.2));
for(const [position,intensity] of [[[3,5,4],3], [[-4,2,-3],2]]){const light=new THREE.DirectionalLight('#ffffff',intensity);light.position.set(...position);scene.add(light);}
const gltf=await new GLTFLoader().loadAsync('/asset.glb');scene.add(gltf.scene);
const box=new THREE.Box3().setFromObject(gltf.scene);if(box.isEmpty())throw new Error('Empty geometry');
const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
const radius=Math.max(size.length()/2,0.001),half=radius*1.15,aspect=${width / height};
let meshes=0;gltf.scene.traverse(o=>{if(o.isMesh)meshes++;});if(!meshes)throw new Error('No meshes');
const directions={front:[0,0,1],left:[-1,0,0],back:[0,0,-1],right:[1,0,0],top:[0,1,0],perspective:[1,0.7,1]};
window.rivetRender=(view)=>{const dir=new THREE.Vector3(...directions[view]).normalize();const perspective=view==='perspective';
const camera=perspective?new THREE.PerspectiveCamera(35,aspect,radius/1000,radius*20):new THREE.OrthographicCamera(-half*aspect,half*aspect,half,-half,radius/1000,radius*20);
camera.position.copy(center).addScaledVector(dir,radius*4);if(view==='top')camera.up.set(0,0,-1);camera.lookAt(center);camera.updateProjectionMatrix();renderer.render(scene,camera);
return {position:camera.position.toArray(),target:center.toArray(),up:camera.up.toArray(),projection:perspective?'perspective':'orthographic',orthographic_size:perspective?null:half*2,units:'m',width:${width},height:${height}};};
window.rivetReady={mesh_count:meshes,bounds_m:{min:box.min.toArray(),max:box.max.toArray()}};
}catch(error){window.rivetError=String(error);}
</script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    if (pathname === '/asset.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(await readFile(asset)); return; }
    const path = resolve(threeRoot, pathname.replace(/^\/three\//, ''));
    if (!pathname.startsWith('/three/') || !path.startsWith(threeRoot + sep) || !path.endsWith('.js')) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => window.rivetReady || window.rivetError, { timeout: 60_000 });
  const error = await page.evaluate(() => window.rivetError);
  if (error) throw new Error(error);
  const metadata = await page.evaluate(() => window.rivetReady);
  const shots = [];
  const digest = createHash('sha256');
  for (const view of ['front', 'left', 'back', 'right', 'top', 'perspective']) {
    const camera = await page.evaluate((name) => window.rivetRender(name), view);
    const path = join(outputDir, `${view}.png`);
    const png = await page.locator('canvas').screenshot({ path, animations: 'disabled' });
    digest.update(png); shots.push({ view, path, camera });
  }
  await writeFile(flag('--output'), JSON.stringify({ shots, render_digest: digest.digest('hex'), ...metadata }, null, 2));
} finally { if (browser) await browser.close(); await new Promise((done) => server.close(done)); }
