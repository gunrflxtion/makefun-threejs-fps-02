// Bots: 4 allies and 5 enemies with a small state machine — advance along the
// waypoint graph, hold a lane, engage what they see, investigate what they hear,
// and work the objective (plant for the carrier, defuse for defenders). Vision
// is a range + field-of-view + line-of-sight raycast; shooting is a real raycast
// with spread, so cover, distance and movement all matter. One job: the bots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMover } from './player.js';
import { WEAPONS } from './weapon.js';
import { findPath, nearestWaypoint } from './world.js';

const ALLY_NAMES = ['VEX', 'NOVA', 'ORION', 'LYNX'];
const FOE_NAMES = ['DUSK', 'MARA', 'PIKE', 'SOL', 'KARL'];
const BOT_SPEED = 3.6;
const BOT_HOLD_SPEED = 2.2;
const SEE_RANGE = 30;
const SEE_FOV = 0.57; // cos(55 deg)
const SCAN_EVERY = 0.12;

export function createBots(scene, world, random) {
  const mover = createMover(world.colliders);
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  // A small pool of fading tracer lines, shared by bot shots.
  const tracers = [];
  for (let i = 0; i < 16; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  function spawnTracer(from, to) {
    const slot = tracers.find((t) => t.life <= 0) ?? tracers[0];
    slot.line.geometry.setFromPoints([from, to]);
    slot.line.material.opacity = 0.85;
    slot.line.visible = true;
    slot.life = 0.09;
  }

  const allyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), roughness: 0.6, metalness: 0.1 });
  const foeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.foe), roughness: 0.6, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const legGeo = new THREE.BoxGeometry(0.44, 0.6, 0.26);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);

  const bots = [];
  const hitMeshes = [];

  function makeBot(index, team) {
    const name = team === 'ally' ? ALLY_NAMES[index] : FOE_NAMES[index];
    const mat = team === 'ally' ? allyMat : foeMat;
    const group = new THREE.Group();
    const legs = new THREE.Mesh(legGeo, darkMat);
    legs.position.y = 0.3;
    const torso = new THREE.Mesh(torsoGeo, mat);
    torso.position.y = 0.99;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 1.55;
    head.userData.part = 'head';
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.18, 1.05, -0.3);
    group.add(legs, torso, head, gun);
    group.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      id: `${team}-${index}`,
      name,
      team,
      body: {
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        yaw: 0,
        height: 1.72,
        eye: 1.6,
        onGround: true,
        crouching: false,
      },
      group,
      torso,
      head,
      health: 100,
      alive: true,
      weaponId: 'rifle',
      state: 'advance',
      path: [],
      pathIdx: 0,
      holdNode: -1,
      holdUntil: 0,
      target: null,
      targetKind: null, // 'player' or bot object
      lastSeenAt: -99,
      scanAt: random() * SCAN_EVERY,
      fireAt: 0,
      burstLeft: 0,
      burstPauseUntil: 0,
      aimYaw: 0,
      aimPitch: 0,
      hasBomb: false,
      channel: 0, // plant/defuse progress seconds
      fall: 0,
      investigateAt: null,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) makeBot(i, 'ally');
  for (let i = 0; i < 5; i += 1) makeBot(i, 'enemy');

  function reset(round, playerTeam) {
    // Player is always an attacker; allies attack with them, enemies defend.
    const laneTargets = { ally: [6, 8, 10, 12, 15], enemy: [21, 22, 23, 13, 14] };
    for (const bot of bots) {
      bot.health = 100;
      bot.alive = true;
      bot.channel = 0;
      bot.target = null;
      bot.fall = 0;
      bot.hasBomb = false;
      bot.state = 'advance';
      bot.burstLeft = 0;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.y = 0;
      const spawnList = bot.team === 'ally' ? world.spawns.attackers : world.spawns.defenders;
      // Allies take spawns 1..4: spawn 0 is the player's.
      const spawnIndex = bot.team === 'ally'
        ? (bots.indexOf(bot) + 1) % spawnList.length
        : bots.indexOf(bot) % spawnList.length;
      const spawn = spawnList[spawnIndex];
      bot.body.position.set(spawn.x, 0, spawn.z);
      bot.body.velocity.set(0, 0, 0);
      bot.body.yaw = spawn.yaw;
      bot.aimYaw = spawn.yaw;
      bot.aimPitch = 0;
      bot.weaponId = bot.team === 'enemy' && random() < 0.2 ? 'sniper' : random() < 0.35 ? 'smg' : 'rifle';
      if (bot.team === 'ally') {
        const lane = laneTargets.ally[Math.floor(random() * laneTargets.ally.length)];
        const from = nearestWaypoint(world.waypoints, spawn.x, spawn.z);
        bot.path = findPath(world.waypoints, from, lane);
        bot.pathIdx = 0;
        bot.holdNode = lane;
      } else {
        const hold = laneTargets.enemy[bots.indexOf(bot) % laneTargets.enemy.length];
        const from = nearestWaypoint(world.waypoints, spawn.x, spawn.z);
        bot.path = findPath(world.waypoints, from, hold);
        bot.pathIdx = 0;
        bot.holdNode = hold;
      }
    }
    // No bot carries the bomb at round start: the player does. If the player
    // goes down, game.js hands the charge to a living ally (see damagePlayer).
  }

  function eyePos(bot, out) {
    out.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    return out;
  }

  function canSee(bot, targetPos, targetEyeY) {
    tmp.copy(targetPos);
    tmp.y = targetEyeY;
    eyePos(bot, tmp2);
    tmpDir.copy(tmp).sub(tmp2);
    const dist = tmpDir.length();
    if (dist > SEE_RANGE) return false;
    tmpDir.normalize();
    const fx = -Math.sin(bot.body.yaw);
    const fz = -Math.cos(bot.body.yaw);
    if (fx * tmpDir.x + fz * tmpDir.z < SEE_FOV && dist > 3) return false;
    raycaster.set(tmp2, tmpDir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance > dist - 0.5;
  }

  // Scan for a visible enemy: the player (if alive and an enemy of this bot)
  // or an opposing bot. Returns {kind, bot|playerPos} or null.
  function scan(bot, env) {
    const enemies = [];
    if (bot.team === 'enemy' && env.playerAlive) enemies.push({ kind: 'player', pos: env.playerPos, eyeY: env.playerPos.y + env.playerEye });
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      enemies.push({ kind: 'bot', bot: other, pos: other.body.position, eyeY: other.body.position.y + 1.35 });
    }
    let best = null;
    let bestD = Infinity;
    for (const e of enemies) {
      const dx = e.pos.x - bot.body.position.x;
      const dz = e.pos.z - bot.body.position.z;
      const d = dx * dx + dz * dz;
      if (d >= bestD) continue;
      if (canSee(bot, e.pos, e.eyeY)) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  function faceToward(bot, x, z, dt) {
    const targetYaw = Math.atan2(-(x - bot.body.position.x), -(z - bot.body.position.z));
    let diff = targetYaw - bot.body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.body.yaw += diff * Math.min(1, dt * 10);
  }

  function fireAt(bot, target, env) {
    const def = WEAPONS[bot.weaponId];
    const from = eyePos(bot, new THREE.Vector3());
    const aim = new THREE.Vector3();
    if (target.kind === 'player') {
      aim.set(env.playerPos.x, env.playerPos.y + env.playerEye * (random() < 0.25 ? 0.95 : 0.7), env.playerPos.z);
    } else {
      const t = target.bot;
      aim.set(t.body.position.x, t.body.position.y + (random() < 0.25 ? 1.55 : 1.0), t.body.position.z);
    }
    const dist = from.distanceTo(aim);
    const spread = 0.012 + dist * 0.0012 + (bot.body.crouching ? -0.004 : 0);
    tmpDir.copy(aim).sub(from).normalize();
    tmpDir.x += (random() * 2 - 1) * spread;
    tmpDir.y += (random() * 2 - 1) * spread;
    tmpDir.z += (random() * 2 - 1) * spread;
    tmpDir.normalize();
    raycaster.set(from, tmpDir);
    raycaster.far = 80;
    const targets = [...world.shootables, ...hitMeshes, ...env.playerHitMeshes];
    const hit = raycaster.intersectObjects(targets, false)[0];
    const end = hit ? hit.point.clone() : from.clone().add(tmpDir.clone().multiplyScalar(40));
    spawnTracer(from, end);
    env.onBotShot(bot, from, dist);
    if (!hit) return;
    if (hit.object.userData.bot) {
      const victim = hit.object.userData.bot;
      if (victim.team !== bot.team) {
        const part = hit.object.userData.part;
        const dmg = def.damage * (part === 'head' ? def.headMult : 1);
        env.onBotHit(bot, victim, dmg, part);
      }
    } else if (hit.object.userData.isPlayer && target.kind === 'player') {
      const part = hit.object.userData.part;
      const dmg = def.damage * (part === 'head' ? def.headMult : 1);
      env.onPlayerHit(bot, dmg, part);
    }
  }

  function stepBot(bot, dt, time, env) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    // Periodic vision scan.
    bot.scanAt -= dt;
    if (bot.scanAt <= 0) {
      bot.scanAt = SCAN_EVERY;
      const seen = scan(bot, env);
      if (seen) {
        bot.target = seen;
        bot.lastSeenAt = time;
        if (bot.state !== 'engage') bot.state = 'engage';
      } else if (bot.state === 'engage' && time - bot.lastSeenAt > 1.2) {
        bot.target = null;
        bot.state = bot.holdNode >= 0 && bot.team === 'enemy' ? 'hold' : 'advance';
      }
    }

    // Objective channels: plant / defuse.
    if (bot.state === 'plant' || bot.state === 'defuse') {
      const done = bot.state === 'plant' ? env.plantTick(bot, dt) : env.defuseTick(bot, dt);
      if (done) bot.state = bot.team === 'ally' ? 'advance' : 'hold';
      bot.group.position.copy(bot.body.position);
      bot.group.rotation.y = bot.body.yaw;
      return;
    }

    let wishX = 0;
    let wishZ = 0;
    let speed = BOT_SPEED;

    if (bot.state === 'engage' && bot.target) {
      const t = bot.target;
      const tx = t.kind === 'player' ? env.playerPos.x : t.bot.body.position.x;
      const tz = t.kind === 'player' ? env.playerPos.z : t.bot.body.position.z;
      faceToward(bot, tx, tz, dt);
      // Hold ground while firing; strafe a little to stay unpredictable.
      const strafe = Math.sin(time * 0.9 + bot.id.charCodeAt(0)) * 0.4;
      const fx = -Math.sin(bot.body.yaw);
      const fz = -Math.cos(bot.body.yaw);
      wishX = -fz * strafe;
      wishZ = fx * strafe;
      speed = BOT_HOLD_SPEED;
      // Fire in bursts.
      if (time >= bot.burstPauseUntil && bot.burstLeft <= 0) {
        bot.burstLeft = 2 + Math.floor(random() * 3);
      }
      if (bot.burstLeft > 0 && time >= bot.fireAt) {
        fireAt(bot, bot.target, env);
        bot.burstLeft -= 1;
        bot.fireAt = time + WEAPONS[bot.weaponId].gap + 0.05;
        if (bot.burstLeft === 0) bot.burstPauseUntil = time + 0.45 + random() * 0.6;
      }
    } else if (bot.state === 'advance' || bot.state === 'investigate') {
      // Follow the waypoint path.
      if (bot.pathIdx < bot.path.length) {
        const node = world.waypoints[bot.path[bot.pathIdx]];
        const dx = node.x - bot.body.position.x;
        const dz = node.z - bot.body.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.7) {
          bot.pathIdx += 1;
        } else {
          wishX = dx / d;
          wishZ = dz / d;
          faceToward(bot, node.x, node.z, dt);
        }
      } else {
        // Reached the end: attackers push to site, defenders hold.
        if (bot.team === 'ally') {
          const site = world.site;
          const dx = site.x - bot.body.position.x;
          const dz = site.z - bot.body.position.z;
          const d = Math.hypot(dx, dz);
          if (d < site.radius && bot.hasBomb && !env.bombPlanted && !env.bombExploded) {
            bot.state = 'plant';
            bot.channel = 0;
          } else if (d < 2) {
            bot.state = 'hold';
            bot.holdUntil = time + 2 + random() * 3;
          } else {
            const from = nearestWaypoint(world.waypoints, bot.body.position.x, bot.body.position.z);
            bot.path = findPath(world.waypoints, from, 16);
            bot.pathIdx = 0;
          }
        } else {
          bot.state = 'hold';
          bot.holdUntil = time + 3 + random() * 4;
        }
      }
    } else if (bot.state === 'hold') {
      // Face the lane; occasionally crouch. Defenders defuse when the bomb is down.
      if (env.bombPlanted && bot.team === 'enemy') {
        const dx = env.bombPos.x - bot.body.position.x;
        const dz = env.bombPos.z - bot.body.position.z;
        if (Math.hypot(dx, dz) < 1.8) {
          bot.state = 'defuse';
          bot.channel = 0;
        } else {
          const from = nearestWaypoint(world.waypoints, bot.body.position.x, bot.body.position.z);
          bot.path = findPath(world.waypoints, from, 16);
          bot.pathIdx = 0;
          bot.state = 'advance';
        }
      } else if (time > bot.holdUntil) {
        // Rotate to a new hold or push on.
        if (bot.team === 'ally') {
          const from = nearestWaypoint(world.waypoints, bot.body.position.x, bot.body.position.z);
          bot.path = findPath(world.waypoints, from, 16);
          bot.pathIdx = 0;
          bot.state = 'advance';
        } else {
          const holds = [21, 22, 23, 13, 14];
          const next = holds[Math.floor(random() * holds.length)];
          const from = nearestWaypoint(world.waypoints, bot.body.position.x, bot.body.position.z);
          bot.path = findPath(world.waypoints, from, next);
          bot.pathIdx = 0;
          bot.state = 'advance';
          bot.holdNode = next;
        }
      } else {
        faceToward(bot, bot.body.position.x - Math.sin(bot.body.yaw) * 5, bot.body.position.z - Math.cos(bot.body.yaw) * 5, dt);
        if (random() < dt * 0.2) bot.body.crouching = !bot.body.crouching;
      }
    }

    mover.setCrouch(bot.body, bot.body.crouching && bot.state !== 'advance');
    mover.step(bot.body, dt, wishX, wishZ, speed, false);
    bot.group.position.copy(bot.body.position);
    bot.group.rotation.y = bot.body.yaw;
    // Aim the gun slightly with the body.
    bot.group.rotation.x = 0;
  }

  function hearNoise(x, z, radius) {
    for (const bot of bots) {
      if (!bot.alive || bot.state === 'engage' || bot.state === 'plant' || bot.state === 'defuse') continue;
      const dx = bot.body.position.x - x;
      const dz = bot.body.position.z - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      if (bot.team === 'enemy') {
        const from = nearestWaypoint(world.waypoints, bot.body.position.x, bot.body.position.z);
        const to = nearestWaypoint(world.waypoints, x, z);
        bot.path = findPath(world.waypoints, from, to);
        bot.pathIdx = 0;
        bot.state = 'investigate';
      } else {
        faceToward(bot, x, z, 0.5);
      }
    }
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) {
      // Getting shot makes a bot turn toward the shooter next scan.
      bot.lastSeenAt = -99;
      return false;
    }
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'dead';
    return true;
  }

  return {
    bots,
    hitMeshes,
    reset,
    hearNoise,
    damage,
    spawnTracer,
    step(dt, time, env) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
          if (t.life <= 0) t.line.visible = false;
        }
      }
      // Freeze time, round breaks and the lobby: bots stand still.
      if (!env.roundLive) return;
      for (const bot of bots) stepBot(bot, dt, time, env);
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    bombCarrier() {
      return bots.find((b) => b.hasBomb && b.alive) ?? null;
    },
  };
}
