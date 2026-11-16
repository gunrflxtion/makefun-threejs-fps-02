// The map: IRONLINE TERMINAL, an original industrial port yard, 64 x 48 m.
// Attackers spawn south, defenders north, one bombsite (SITE A) at the north end.
// Three lanes — west yard, mid containers, east yard — with crates, stacked
// containers and a silo for corners and sightlines. Every solid box is both a
// collider and a surface a bullet stops on; the waypoint graph is what the bots
// walk. Plain geometry only, no models, no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints: [x, z, ...linked node indexes]. Bots walk the graph with BFS.
const WAYPOINTS = [
  [0, 21, 1, 2, 3],       // 0 attacker spawn centre
  [-8, 21, 0, 4],         // 1 attacker spawn west
  [8, 21, 0, 7],          // 2 attacker spawn east
  [0, 13, 0, 5, 4, 7],    // 3 mid south
  [-14, 16, 1, 5, 10],    // 4 west south
  [-20, 8, 4, 6, 11],     // 5 west mid-south
  [0, 4, 3, 8, 5, 9],     // 6 mid centre
  [14, 16, 2, 9, 3],      // 7 east south
  [0, -4, 6, 10, 11, 12], // 8 mid north
  [20, 8, 7, 12, 6],      // 9 east mid-south
  [-22, 0, 5, 11, 13],    // 10 west mid
  [-20, -8, 10, 13, 8],   // 11 west mid-north
  [22, 0, 9, 14, 8],      // 12 east mid
  [-16, -16, 11, 15, 14], // 13 west approach
  [20, -8, 12, 15, 9],    // 14 east mid-north
  [0, -12, 8, 13, 14, 16, 17], // 15 site approach
  [0, -18, 15],           // 16 SITE A centre
  [-8, -18, 15, 18],      // 17 site west
  [8, -18, 15, 19],       // 18 site east
  [-6, -21, 17],          // 19 defender spawn west
  [6, -21, 18],           // 20 defender spawn east
  [-12, -10, 13, 8],      // 21 defender hold west
  [12, -10, 14, 8],       // 22 defender hold east
  [0, -8, 8, 15],         // 23 defender hold mid
  [-26, -4, 10],          // 24 west corner
  [26, -4, 12],           // 25 east corner
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  // Rusted container paint: two extra tints from the same palette family.
  const rust = new THREE.MeshStandardMaterial({ color: 0x8a4a22, roughness: 0.85, metalness: 0.1 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x2e5f66, roughness: 0.8, metalness: 0.12 });
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(r, h, x, z, mat) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: 64 x 48 m yard, 5 m walls.
  box(64.4, 0.4, 48.4, 0, -0.2, 0, materials.canvas);
  box(0.5, 5, 48.4, -32.2, 2.5, 0, materials.surface);
  box(0.5, 5, 48.4, 32.2, 2.5, 0, materials.surface);
  box(64.4, 5, 0.5, 0, 2.5, -24.2, materials.surface);
  box(64.4, 5, 0.5, 0, 2.5, 24.2, materials.surface);

  // SITE A: a marked pad at the north end plus a beacon pole.
  const sitePad = box(10, 0.06, 8, 0, 0.03, -18.5, materials.accent, false);
  sitePad.castShadow = false;
  box(0.3, 4.2, 0.3, -4.6, 2.1, -21.8, materials.hairline);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  beacon.position.set(-4.6, 4.4, -21.8);
  group.add(beacon);

  // Mid lane: stacked containers and a low crate wall.
  box(6, 2.6, 2.4, -3.4, 1.3, 6, rust);
  box(6, 2.6, 2.4, 3.4, 1.3, -2, teal);
  box(6, 2.6, 2.4, -3.4, 3.9, 6, teal);
  box(3.4, 1.0, 1.2, 5.2, 0.5, 4.6, materials.hairline);
  box(3.4, 1.0, 1.2, -5.6, 0.5, -6.4, materials.hairline);
  box(1.2, 2.2, 1.2, 0, 1.1, -9.5, materials.hairline);

  // West yard: crates, a container stack and the silo.
  box(4, 2.6, 2.4, -18, 1.3, 4, teal);
  box(2.2, 1.1, 2.2, -24, 0.55, -6, materials.hairline);
  box(2.2, 1.1, 2.2, -14, 0.55, -13, materials.hairline);
  box(6, 2.6, 2.4, -26, 1.3, -16, rust);
  cylinder(2.6, 6.5, -28, 10, materials.hairline);
  box(3, 1.2, 3, -8, 0.6, 14, materials.hairline);

  // East yard: mirror of the west, different paint.
  box(4, 2.6, 2.4, 18, 1.3, 4, rust);
  box(2.2, 1.1, 2.2, 24, 0.55, -6, materials.hairline);
  box(2.2, 1.1, 2.2, 14, 0.55, -13, materials.hairline);
  box(6, 2.6, 2.4, 26, 1.3, -16, teal);
  cylinder(2.6, 6.5, 28, 10, materials.hairline);
  box(3, 1.2, 3, 8, 0.6, 14, materials.hairline);

  // Site cover: low barriers and stacked containers guarding the pad.
  box(4.4, 1.1, 1.1, -6.5, 0.55, -14.5, materials.hairline);
  box(4.4, 1.1, 1.1, 6.5, 0.55, -14.5, materials.hairline);
  box(6, 2.6, 2.4, -12, 1.3, -21, rust);
  box(6, 2.6, 2.4, 12, 1.3, -21, teal);

  // Spawn cover.
  box(2.4, 1.0, 1.2, -6, 0.5, 18, materials.hairline);
  box(2.4, 1.0, 1.2, 6, 0.5, 18, materials.hairline);
  box(2.4, 1.0, 1.2, -10, 0.5, -20, materials.hairline);
  box(2.4, 1.0, 1.2, 10, 0.5, -20, materials.hairline);

  // Paint stripes on the ground: lane guides, visual only.
  box(0.5, 0.02, 30, -16, 0.02, 0, materials.accent, false).castShadow = false;
  box(0.5, 0.02, 30, 16, 0.02, 0, materials.accent, false).castShadow = false;

  // Light: low dusk sun from the south-west, cool fill, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.muted), new THREE.Color(PALETTE.canvas), 1.5);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(0xffe0b8), 2.6);
  key.position.set(-14, 18, 16);
  key.target.position.set(0, 0, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -36;
  key.shadow.camera.right = 36;
  key.shadow.camera.top = 36;
  key.shadow.camera.bottom = -36;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.75);
  fill.position.set(12, 10, -14);
  scene.add(fill);
  const siteLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 24, 16, 1.6);
  siteLight.position.set(-4.6, 4.6, -21.8);
  scene.add(siteLight);

  const waypoints = WAYPOINTS.map(([x, z, ...links]) => ({ x, z, links }));

  return {
    colliders,
    shootables,
    group,
    waypoints,
    site: { x: 0, z: -18.5, radius: 5.5 },
    spawns: {
      attackers: [
        { x: 0, z: 21, yaw: 0 },
        { x: -8, z: 21, yaw: 0 },
        { x: 8, z: 21, yaw: 0 },
        { x: -4, z: 22, yaw: 0 },
        { x: 4, z: 22, yaw: 0 },
      ],
      defenders: [
        { x: -6, z: -21, yaw: Math.PI },
        { x: 6, z: -21, yaw: Math.PI },
        { x: -12, z: -20, yaw: Math.PI },
        { x: 12, z: -20, yaw: Math.PI },
        { x: 0, z: -22, yaw: Math.PI },
      ],
    },
  };
}

/** BFS over the waypoint graph: returns node indexes from `from` to `to`. */
export function findPath(waypoints, from, to) {
  if (from === to) return [to];
  const prev = new Array(waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const node = queue.shift();
    for (const next of waypoints[node].links) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === to) {
        const path = [to];
        let cur = to;
        while (cur !== from) {
          cur = prev[cur];
          path.unshift(cur);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

/** Nearest waypoint index to a point. */
export function nearestWaypoint(waypoints, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i += 1) {
    const dx = waypoints[i].x - x;
    const dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
