// The match: rounds, money, the buy menu, the bomb and the win conditions.
// One place owns the state — phase, score, money, health, the bomb — and the
// transitions between them; main.js feeds it input and renders what it says.
// IRON (the player + 4 bots) attacks, RUST (5 bots) defends SITE A.
import * as THREE from 'three';
import { WEAPONS } from './weapon.js';

const BUY_SECONDS = 8;
const ROUND_SECONDS = 100;
const BOMB_SECONDS = 35;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const WIN_ROUNDS = 5;
const WIN_BONUS = 3250;
const LOSS_BONUS = 1900;
const KILL_BONUS = 300;
const PLANT_BONUS = 300;

export function createGame(deps) {
  const { scene, world, player, bots, weapon, hud, audio, random } = deps;

  const state = {
    phase: 'lobby', // lobby | buy | live | roundEnd | matchEnd
    round: 0,
    scoreAlly: 0,
    scoreFoe: 0,
    money: 800,
    health: 100,
    armor: 0,
    owned: new Set(['pistol']),
    phaseLeft: 0,
    bomb: { state: 'carried', x: 0, z: -18.5, timer: 0, carrier: 'player' },
    playerAlive: true,
    plantProgress: 0,
    defuseProgress: 0,
    kills: 0,
    deaths: 0,
  };

  // Grenades in flight.
  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e5f66, roughness: 0.4, metalness: 0.4 });
  // Explosion flash: one reusable mesh + light.
  const blastGeo = new THREE.SphereGeometry(1, 16, 12);
  const blastMat = new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0 });
  const blast = new THREE.Mesh(blastGeo, blastMat);
  blast.visible = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(0xff8c1a, 0, 18);
  scene.add(blastLight);
  let blastLife = 0;

  // The planted bomb: a small blinking charge on the pad.
  const bombGeo = new THREE.BoxGeometry(0.5, 0.22, 0.34);
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.3 });
  const bombMesh = new THREE.Mesh(bombGeo, bombMat);
  const bombLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xe5484d }),
  );
  bombLed.position.y = 0.14;
  bombMesh.add(bombLed);
  bombMesh.visible = false;
  scene.add(bombMesh);

  function syncHud() {
    hud.setHealth(state.health, state.armor);
    hud.setMoney(state.money);
    hud.setAmmo(weapon.mag(), weapon.reserve(), weapon.current().name);
    hud.setScore(state.scoreAlly, state.scoreFoe);
    hud.setAlive(bots.aliveCount('ally') + (state.playerAlive ? 1 : 0), bots.aliveCount('enemy'));
  }

  function startMatch() {
    state.round = 0;
    state.scoreAlly = 0;
    state.scoreFoe = 0;
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.owned = new Set(['pistol']);
    startRound();
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.phaseLeft = BUY_SECONDS;
    state.health = 100;
    state.armor = state.owned.has('armor') ? 50 : 0;
    state.playerAlive = true;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.bomb = { state: 'carried', x: 0, z: -18.5, timer: 0, carrier: 'player' };
    bombMesh.visible = false;
    weapon.refill();
    // Re-buy what was owned (weapons persist as owned; ammo refilled).
    for (const id of state.owned) {
      if (id !== 'armor' && id !== 'pistol') weapon.give(id);
    }
    weapon.equip(state.owned.has('rifle') ? 'rifle' : state.owned.has('smg') ? 'smg' : state.owned.has('shotgun') ? 'shotgun' : state.owned.has('sniper') ? 'sniper' : 'pistol');
    const spawn = world.spawns.attackers[0];
    player.teleport(spawn.x, spawn.z, spawn.yaw);
    bots.reset(state.round, 'ally');
    hud.buildBuyMenu(buyWeapon);
    hud.markOwned(state.owned);
    hud.showBuy(true);
    hud.showBanner(`ROUND ${state.round}`, 'Buy phase — spend your money, then push SITE A', 3000);
    audio.roundStart();
    syncHud();
  }

  function buyWeapon(id) {
    if (state.phase !== 'buy') return false;
    const def = WEAPONS[id];
    if (id === 'armor') {
      if (state.armor >= 50 || state.money < 650) {
        audio.deny();
        return false;
      }
      state.money -= 650;
      state.armor = 50;
      state.owned.add('armor');
    } else if (id === 'grenade') {
      if (state.money < def.price || weapon.state.grenades >= 2) {
        audio.deny();
        return false;
      }
      state.money -= def.price;
      weapon.give('grenade');
      state.owned.add('grenade');
    } else {
      if (state.owned.has(id) || state.money < def.price) {
        audio.deny();
        return false;
      }
      state.money -= def.price;
      weapon.give(id);
      state.owned.add(id);
      weapon.equip(id);
    }
    audio.buy();
    hud.markOwned(state.owned);
    syncHud();
    return true;
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live') return;
    state.phase = 'roundEnd';
    state.phaseLeft = 4;
    hud.showBuy(false);
    hud.hidePlant();
    if (winner === 'ally') {
      state.scoreAlly += 1;
      state.money += WIN_BONUS;
    } else {
      state.scoreFoe += 1;
      state.money += LOSS_BONUS;
    }
    hud.showBanner(
      winner === 'ally' ? 'ROUND WON' : 'ROUND LOST',
      reason,
      3600,
    );
    audio.roundEnd(winner === 'ally');
    syncHud();
  }

  function endMatch() {
    state.phase = 'matchEnd';
    hud.showBuy(false);
    const won = state.scoreAlly > state.scoreFoe;
    hud.showOverlay('matchEnd', won
      ? `IRON takes the match ${state.scoreAlly} — ${state.scoreFoe}. ${state.kills} eliminations, ${state.deaths} deaths.`
      : `RUST takes the match ${state.scoreFoe} — ${state.scoreAlly}. ${state.kills} eliminations, ${state.deaths} deaths.`);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function checkWin() {
    if (state.phase !== 'live') return;
    // Once the bomb is planted the round is decided by the bomb, not by kills.
    if (state.bomb.state !== 'carried') return;
    const allies = bots.aliveCount('ally') + (state.playerAlive ? 1 : 0);
    const foes = bots.aliveCount('enemy');
    if (foes === 0) {
      endRound('ally', 'RUST team eliminated');
    } else if (allies === 0) {
      endRound('foe', 'IRON team eliminated');
    }
  }

  function plantBomb(x, z, byPlayer) {
    state.bomb = { state: 'planted', x, z, timer: BOMB_SECONDS, carrier: null };
    bombMesh.position.set(x, 0.12, z);
    bombMesh.visible = true;
    state.plantProgress = 0;
    if (byPlayer) {
      state.money += PLANT_BONUS;
      hud.addKill('YOU planted the charge at SITE A  +$300');
    } else {
      hud.addKill('Charge planted at SITE A');
    }
    hud.showBanner('CHARGE PLANTED', 'Defend it — 35 seconds to detonation', 3000);
    audio.plant();
    syncHud();
  }

  function explodeBomb() {
    state.bomb.state = 'exploded';
    bombMesh.visible = false;
    blast.position.set(state.bomb.x, 0.6, state.bomb.z);
    blast.visible = true;
    blastLife = 0.5;
    blastLight.position.set(state.bomb.x, 2, state.bomb.z);
    blastLight.intensity = 60;
    audio.explosion();
    bots.hearNoise(state.bomb.x, state.bomb.z, 40);
    // Blast hurts everyone close, friend or foe.
    const victims = [];
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.body.position.x - state.bomb.x, bot.body.position.z - state.bomb.z);
      if (d < 9) victims.push({ bot, dmg: Math.max(20, 130 - d * 12) });
    }
    for (const v of victims) {
      const killed = bots.damage(v.bot, v.dmg);
      if (killed) hud.addKill(`💥 ${v.bot.name} caught in the blast`);
    }
    if (state.playerAlive) {
      const d = Math.hypot(player.state.position.x - state.bomb.x, player.state.position.z - state.bomb.z);
      if (d < 9) damagePlayer(Math.max(20, 130 - d * 12), 'blast', 'the blast');
    }
    endRound('ally', 'The charge detonated at SITE A');
  }

  function defuseBomb(byPlayer) {
    state.bomb.state = 'defused';
    bombMesh.visible = false;
    state.defuseProgress = 0;
    if (!byPlayer) hud.addKill('RUST defused the charge');
    endRound('foe', 'The charge was defused');
  }

  // Player holds E near the site to plant; returns true while channelling.
  function playerPlant(dt, holding, nearSite) {
    if (state.phase !== 'live' || state.bomb.state !== 'carried' || state.bomb.carrier !== 'player') return false;
    if (!holding || !nearSite || !state.playerAlive) {
      state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
      return false;
    }
    state.plantProgress += dt;
    if (state.plantProgress >= PLANT_SECONDS) {
      plantBomb(player.state.position.x, player.state.position.z, true);
      return true;
    }
    return true;
  }

  function botPlantTick(bot, dt) {
    if (state.bomb.state !== 'carried' || state.bomb.carrier !== bot.id) return true;
    bot.channel += dt;
    if (bot.channel >= PLANT_SECONDS) {
      plantBomb(bot.body.position.x, bot.body.position.z, false);
      return true;
    }
    return false;
  }

  function botDefuseTick(bot, dt) {
    if (state.bomb.state !== 'planted') return true;
    bot.channel += dt;
    if (bot.channel >= DEFUSE_SECONDS) {
      defuseBomb(false);
      return true;
    }
    return false;
  }

  function damagePlayer(amount, part, attackerName) {
    if (!state.playerAlive || state.phase !== 'live') return;
    let rest = amount;
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, rest * 0.5);
      state.armor -= absorbed;
      rest -= absorbed;
    }
    state.health -= rest;
    audio.hurt();
    if (state.health <= 0) {
      state.health = 0;
      state.playerAlive = false;
      state.deaths += 1;
      hud.addKill(`${attackerName} ⌖ YOU${part === 'head' ? ' (headshot)' : ''}`);
      hud.showBanner('YOU ARE DOWN', 'Your team fights on — next round you respawn', 3000);
      if (document.pointerLockElement) document.exitPointerLock();
      // The bomb passes to a living ally bot.
      if (state.bomb.state === 'carried' && state.bomb.carrier === 'player') {
        const alive = bots.bots.filter((b) => b.team === 'ally' && b.alive);
        if (alive.length > 0) {
          const next = alive[Math.floor(random() * alive.length)];
          next.hasBomb = true;
          state.bomb.carrier = next.id;
          hud.addKill(`${next.name} picked up the charge`);
        }
      }
    }
    syncHud();
    checkWin();
  }

  function onBotHit(shooterName, victim, dmg, part) {
    if (!victim.alive) return;
    const killed = bots.damage(victim, dmg);
    if (killed && victim.hasBomb) {
      // The charge passes to another living ally.
      victim.hasBomb = false;
      const alive = bots.bots.filter((b) => b.team === 'ally' && b.alive);
      if (alive.length > 0) {
        const next = alive[Math.floor(random() * alive.length)];
        next.hasBomb = true;
        state.bomb.carrier = next.id;
        hud.addKill(`${next.name} picked up the charge`);
      } else if (state.bomb.carrier === victim.id) {
        state.bomb.carrier = null;
      }
    }
    if (shooterName === 'YOU') {
      audio.hit(killed);
      if (killed) {
        state.kills += 1;
        state.money += KILL_BONUS;
        hud.addKill(`YOU ⌖ ${victim.name}${part === 'head' ? ' (headshot)' : ''}  +$300`);
      } else {
        hud.addKill(`YOU hit ${victim.name}`);
      }
    } else if (killed) {
      hud.addKill(`${shooterName} ⌖ ${victim.name}`);
    }
    syncHud();
    checkWin();
  }

  function throwGrenade(from, dir) {
    if (weapon.state.grenades <= 0) return false;
    weapon.state.grenades -= 1;
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(from);
    scene.add(mesh);
    grenades.push({
      mesh,
      vel: new THREE.Vector3(dir.x * 17, dir.y * 17 + 4.5, dir.z * 17),
      fuse: 1.6,
    });
    audio.deny();
    return true;
  }

  function explodeGrenade(g) {
    scene.remove(g.mesh);
    blast.position.copy(g.mesh.position);
    blast.visible = true;
    blastLife = 0.35;
    blastLight.position.copy(g.mesh.position).y += 1;
    blastLight.intensity = 40;
    audio.explosion();
    bots.hearNoise(g.mesh.position.x, g.mesh.position.z, 35);
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.body.position.x - g.mesh.position.x, bot.body.position.z - g.mesh.position.z);
      if (d < 6.5) {
        const killed = bots.damage(bot, Math.max(15, 95 - d * 12));
        if (killed) hud.addKill(`💥 ${bot.name} caught by a grenade`);
      }
    }
    if (state.playerAlive) {
      const d = Math.hypot(player.state.position.x - g.mesh.position.x, player.state.position.z - g.mesh.position.z);
      if (d < 6.5) damagePlayer(Math.max(15, 95 - d * 12), 'blast', 'a grenade');
    }
    syncHud();
    checkWin();
  }

  function update(dt, time) {
    // Blast flash decay.
    if (blastLife > 0) {
      blastLife -= dt;
      const k = Math.max(0, blastLife / 0.5);
      blast.scale.setScalar(1 + (1 - k) * 7);
      blastMat.opacity = k * 0.55;
      blastLight.intensity = k * 60;
      if (blastLife <= 0) {
        blast.visible = false;
        blastLight.intensity = 0;
      }
    }
    // Grenades in flight.
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.vel.y -= 14 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      if (g.mesh.position.y < 0.09) {
        g.mesh.position.y = 0.09;
        g.vel.y *= -0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        explodeGrenade(g);
        grenades.splice(i, 1);
      }
    }
    // Bomb blink + timer.
    if (state.bomb.state === 'planted') {
      bombLed.material.color.setHex(Math.floor(time * 4) % 2 === 0 ? 0xe5484d : 0x550000);
      state.bomb.timer -= dt;
      if (state.bomb.timer <= 0) explodeBomb();
    }

    if (state.phase === 'buy') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0) {
        state.phase = 'live';
        state.phaseLeft = ROUND_SECONDS;
        hud.showBuy(false);
        hud.showBanner('GO GO GO', 'Plant the charge at SITE A', 1800);
      }
    } else if (state.phase === 'live') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0 && state.bomb.state !== 'planted') {
        endRound('foe', 'Time expired — SITE A held');
      } else if (state.phaseLeft <= 0 && state.bomb.state === 'planted') {
        // Bomb already ticking; the round clock no longer matters.
        state.phaseLeft = 0;
      }
    } else if (state.phase === 'roundEnd') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0) {
        if (state.scoreAlly >= WIN_ROUNDS || state.scoreFoe >= WIN_ROUNDS) endMatch();
        else startRound();
      }
    }

    // HUD timer.
    if (state.phase === 'buy') hud.setTimer(state.phaseLeft, 'buy');
    else if (state.phase === 'live') {
      hud.setTimer(state.bomb.state === 'planted' ? state.bomb.timer : state.phaseLeft, state.bomb.state === 'planted' ? 'bomb' : 'live');
    } else hud.setTimer(0, state.phase);
  }

  return {
    state,
    startMatch,
    startRound,
    buyWeapon,
    update,
    damagePlayer,
    onBotHit,
    playerPlant,
    botPlantTick,
    botDefuseTick,
    throwGrenade,
    syncHud,
    checkWin,
    endRound,
    nearSite(x, z) {
      const dx = x - world.site.x;
      const dz = z - world.site.z;
      return dx * dx + dz * dz < world.site.radius * world.site.radius;
    },
    nearBomb(x, z) {
      if (state.bomb.state !== 'planted') return false;
      const dx = x - state.bomb.x;
      const dz = z - state.bomb.z;
      return dx * dx + dz * dz < 2.2 * 2.2;
    },
  };
}
