// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. Owns the shooting raycast, the camera, the keys that switch
// weapons and throw grenades, and the screenshot poses (?shot=start|play|end
// with &seed=N, plus ?auto=1 to play without pointer lock).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createGame } from './game.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const auto = params.get('auto') === '1';
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 78);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const weapon = createWeapon(camera);
const hud = createHud();
const player = createPlayer(world.colliders);
const bots = createBots(scene, world, random);
const game = createGame({ scene, world, player, bots, weapon, hud, audio, random });
const input = createInput(renderer.domElement, onLockChange, auto);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes);

// Invisible hit boxes for the player, so bot bullets can hit them.
const playerTorso = new THREE.Mesh(
  new THREE.BoxGeometry(0.68, 1.1, 0.4),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
);
playerTorso.userData.isPlayer = true;
playerTorso.userData.part = 'torso';
const playerHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.17, 10, 8),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
);
playerHead.userData.isPlayer = true;
playerHead.userData.part = 'head';
scene.add(playerTorso, playerHead);
const playerHitMeshes = [playerTorso, playerHead];

const body = player.state;
const direction = new THREE.Vector3();
let elapsed = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let lastFiring = false;

const botEnv = {
  get playerAlive() {
    return game.state.playerAlive;
  },
  get playerPos() {
    return body.position;
  },
  get playerEye() {
    return body.eye;
  },
  playerHitMeshes,
  get bombPlanted() {
    return game.state.bomb.state === 'planted';
  },
  get bombExploded() {
    return game.state.bomb.state === 'exploded';
  },
  get bombPos() {
    return { x: game.state.bomb.x, z: game.state.bomb.z };
  },
  get roundLive() {
    return game.state.phase === 'live';
  },
  onBotShot(bot, from) {
    if (from.distanceTo(body.position) < 30) audio.distantShot();
  },
  onBotHit(shooterBot, victim, dmg, part) {
    game.onBotHit(shooterBot.name, victim, dmg, part);
  },
  onPlayerHit(bot, dmg, part) {
    game.damagePlayer(dmg, part, bot.name);
  },
  plantTick(bot, dt) {
    return game.botPlantTick(bot, dt);
  },
  defuseTick(bot, dt) {
    return game.botDefuseTick(bot, dt);
  },
};

function syncPlayerHitMeshes() {
  playerTorso.position.set(body.position.x, body.position.y + 1.0, body.position.z);
  playerHead.position.set(body.position.x, body.position.y + 1.55, body.position.z);
  playerTorso.visible = game.state.playerAlive;
  playerHead.visible = game.state.playerAlive;
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  const def = weapon.current();
  if (def.id === 'grenade') {
    if (weapon.state.grenades > 0) {
      camera.getWorldDirection(direction);
      game.throwGrenade(camera.position, direction);
      weapon.state.grenades -= 1;
      weapon.pullTrigger();
    }
    return false;
  }
  if (!weapon.takeRound()) {
    audio.dryClick();
    return false;
  }
  let hitSomething = false;
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    camera.getWorldDirection(direction);
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, direction);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    const end = hit ? hit.point : camera.position.clone().add(direction.clone().multiplyScalar(50));
    bots.spawnTracer(camera.position, end);
    if (hit && hit.object.userData.bot) {
      const victim = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const dmg = def.damage * (part === 'head' ? def.headMult : 1);
      game.onBotHit('YOU', victim, dmg, part);
      hud.hitMarker(victim.health <= 0, shot ? 4000 : 90);
      hitSomething = true;
    } else if (hit) {
      // A wall or crate took the bullet: a short spark of feedback is enough.
      hitSomething = true;
    }
  }
  weapon.pullTrigger();
  player.recoil(def.kick + random() * 0.003, (random() * 2 - 1) * 0.003);
  audio.shot(def.kind);
  bots.hearNoise(body.position.x, body.position.z, 28);
  hud.setAmmo(weapon.mag(), weapon.reserve(), def.name);
  return hitSomething;
}

function primaryOwned() {
  for (const id of ['rifle', 'sniper', 'shotgun', 'smg']) {
    if (game.state.owned.has(id)) return id;
  }
  return 'pistol';
}

function handleKeys() {
  // Buy-menu hotkeys (1-6) only during the buy phase; weapon slots otherwise.
  if (game.state.phase === 'buy') {
    const buyIds = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'grenade', 'armor'];
    for (let i = 0; i < buyIds.length; i += 1) {
      if (input.takePressed(`Digit${i + 1}`)) game.buyWeapon(buyIds[i]);
    }
    if (input.takePressed('KeyB')) hud.showBuy(document.getElementById('buy-menu').hidden);
  } else {
    if (input.takePressed('Digit1')) weapon.equip(primaryOwned());
    if (input.takePressed('Digit2')) weapon.equip('pistol');
    if (input.takePressed('Digit3') && weapon.state.grenades > 0) weapon.equip('grenade');
  }
  if (input.takePressed('KeyR')) weapon.reload();
  if (input.takePressed('KeyG') && weapon.state.grenades > 0) {
    camera.getWorldDirection(direction);
    game.throwGrenade(camera.position, direction);
    weapon.state.grenades -= 1;
  }
}

function stepSim(dt) {
  elapsed += dt;
  if (game.state.playerAlive && game.state.phase !== 'matchEnd') {
    player.step(dt, input.state.keys);
  }
  weapon.step(dt);
  bots.step(dt, elapsed, botEnv);
  game.update(dt, elapsed);
  syncPlayerHitMeshes();

  // Plant channel: hold E near SITE A while carrying the charge.
  const holdingE = input.state.keys.has('KeyE');
  const nearSite = game.nearSite(body.position.x, body.position.z);
  if (game.state.phase === 'live' && game.state.bomb.state === 'carried' && game.state.bomb.carrier === 'player') {
    const channelling = game.playerPlant(dt, holdingE, nearSite);
    if (channelling && holdingE && nearSite) {
      hud.showPlant(game.state.plantProgress / 3, 'PLANTING CHARGE — hold E');
    } else {
      hud.hidePlant();
    }
  } else {
    hud.hidePlant();
  }
  syncCamera();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    handleKeys();
    const firing = input.state.firing;
    const def = weapon.current();
    const wantFire = game.state.phase === 'live' && game.state.playerAlive && firing && (def.auto || !lastFiring);
    if (wantFire && weapon.ready()) shoot(shot ? 0 : weapon.spread(player.groundSpeed()));
    lastFiring = firing;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      stepSim(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    hud.setCrosshair(weapon.spread(player.groundSpeed()));
    hud.setAmmo(weapon.mag(), weapon.reserve(), def.name);
    syncCamera();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot || auto) return;
  audio.unlock();
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (game.state.phase !== 'matchEnd') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot || auto) return;
  audio.unlock();
  if (game.state.phase === 'matchEnd') {
    game.startMatch();
    input.requestLock();
    return;
  }
  if (game.state.phase === 'lobby') game.startMatch();
  input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug + play-test handle: the state a headless run can read.
window.__game = { game, player, bots, weapon, hud, world };
window.__log = [];
const origLog = console.log.bind(console);
console.log = (...args) => {
  window.__log.push(args.join(' '));
  origLog(...args);
};
console.log('[ironline] boot seed=' + seed + ' auto=' + auto + ' shot=' + shot);

function settle(seconds) {
  const steps = Math.round(seconds / FIXED_STEP);
  for (let i = 0; i < steps; i += 1) stepSim(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
      console.log('[ironline] shot ready: ' + shot);
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  game.startMatch();
  if (name === 'start') {
    // Buy phase at the attacker spawn, looking up mid lane.
    body.position.set(0, 0, 21);
    body.yaw = 0;
    body.pitch = 0.02;
    settle(0.5);
    hud.showBuy(true);
  } else if (name === 'play') {
    settle(14);
    hud.showBuy(false);
    // Push up mid lane for the frame, like a player taking the fight to SITE A.
    player.teleport(0, 4, 0);
    settle(0.5);
    hud.clearBanner();
    // Aim at the nearest living enemy bot with a clear line of sight.
    syncCamera();
    scene.updateMatrixWorld(true);
    const candidates = bots.bots
      .filter((b) => b.alive && b.team === 'enemy')
      .map((b) => ({ bot: b, d: Math.hypot(b.body.position.x - body.position.x, b.body.position.z - body.position.z) }))
      .sort((a, b) => a.d - b.d);
    let best = null;
    for (const c of candidates) {
      const target = new THREE.Vector3(c.bot.body.position.x, c.bot.body.position.y + 1.1, c.bot.body.position.z);
      const dir = target.clone().sub(camera.position).normalize();
      raycaster.set(camera.position, dir);
      const hit = raycaster.intersectObjects(world.shootables, false)[0];
      if (!hit || hit.distance > camera.position.distanceTo(target) - 0.5) {
        best = c.bot;
        break;
      }
    }
    if (best) {
      aimAt(new THREE.Vector3(best.body.position.x, best.body.position.y + 1.1, best.body.position.z));
      // One real burst at the target, so the frame shows a live firefight.
      shoot(0);
      settle(0.15);
      shoot(0);
    }
  } else if (name === 'end') {
    settle(12);
    hud.showBuy(false);
    game.endRound('ally', 'RUST team eliminated');
    settle(0.5);
  }
  game.syncHud();
  hud.setAmmo(weapon.mag(), weapon.reserve(), weapon.current().name);
  paintTwiceThenReady();
}

syncCamera();
game.syncHud();
if (shot) {
  runShot(shot);
} else if (auto) {
  hud.hideOverlay();
  game.startMatch();
  requestAnimationFrame(frame);
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
