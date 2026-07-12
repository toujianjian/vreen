// @vreen/engine — minimal browser demo.
//
// Boots the engine, creates a scene with one mesh + a grid, runs a render
// loop, and shows an FPS counter. No third-party deps.
import { WebGL2Renderer, Scene, PerspectiveCamera, Mesh, BoxGeometry, StandardMaterial, AmbientLight, DirectionalLight, OrbitControls, createGridMesh, setLoggerSink, setMinLevel, } from '../dist/index.js';
const log = (msg) => {
    const el = document.getElementById('fps');
    if (el)
        el.textContent = msg;
};
setLoggerSink((e) => {
    const tag = `[engine][${e.module}]`;
    if (e.level === 'error')
        console.error(tag, e.message);
    else if (e.level === 'warn')
        console.warn(tag, e.message);
    else
        console.info(tag, e.message);
});
setMinLevel('info');
const container = document.getElementById('app');
const canvas = document.createElement('canvas');
canvas.style.width = '100%';
canvas.style.height = '100%';
container.appendChild(canvas);
const renderer = new WebGL2Renderer(canvas);
renderer.resize(window.innerWidth, window.innerHeight);
const scene = new Scene();
const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(2.5, 1.8, 3.0);
camera.lookAt(0, 0.5, 0);
const controls = new OrbitControls(camera, canvas);
scene.add(new AmbientLight(0xffffff, 0.4));
const sun = new DirectionalLight(0xfff0dd, 1.2, { x: 3, y: 4, z: 2 });
sun.position.set(3, 4, 2);
scene.add(sun);
const grid = createGridMesh(renderer, { size: 10, cellSize: 0.5, sectionSize: 1.0, cellColor: [0.1, 0.225, 0.29], sectionColor: [0, 0.94, 1] });
scene.add(grid);
const boxMat = new StandardMaterial();
boxMat.baseColor = { r: 0.6, g: 0.7, b: 1.0 };
boxMat.metallic = 0.6;
boxMat.roughness = 0.3;
const box = new Mesh(new BoxGeometry(1, 1, 1), boxMat);
box.position.set(0, 0.5, 0);
scene.add(box);
let lastTime = performance.now();
let frames = 0;
let acc = 0;
function frame(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    acc += dt;
    frames++;
    box.rotation.y += dt * 0.5;
    controls.update();
    renderer.render(scene, camera);
    if (acc >= 1) {
        log(`${(frames / acc).toFixed(1)} fps · ${renderer.stats.drawCalls} draw calls`);
        frames = 0;
        acc = 0;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});
