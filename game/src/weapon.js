// Weapons: one data table the buy menu and the HUD both read, and one view
// model that swaps shape per weapon. Hitscan fire, a magazine, a reload, and
// the spread that punishes moving: stopping to aim pays. main.js owns the ray
// and the damage; this module owns the numbers and the gun in your hands.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'VK-9 Sidearm', price: 0, damage: 34, headMult: 3.5,
    mag: 12, reserve: Infinity, auto: false, gap: 0.16, reload: 1.4,
    spreadStill: 0.004, spreadMove: 0.03, pellets: 1, kick: 0.006, kind: 'pistol',
  },
  smg: {
    id: 'smg', name: 'KR-7 Ripper', price: 1500, damage: 26, headMult: 3.5,
    mag: 25, reserve: 100, auto: true, gap: 0.075, reload: 1.7,
    spreadStill: 0.006, spreadMove: 0.035, pellets: 1, kick: 0.005, kind: 'smg',
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Ironline', price: 2700, damage: 33, headMult: 3.5,
    mag: 30, reserve: 90, auto: true, gap: 0.096, reload: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, pellets: 1, kick: 0.009, kind: 'rifle',
  },
  sniper: {
    id: 'sniper', name: 'LR-50 Longshot', price: 4750, damage: 110, headMult: 2.5,
    mag: 5, reserve: 15, auto: false, gap: 1.1, reload: 2.8,
    spreadStill: 0.0008, spreadMove: 0.05, pellets: 1, kick: 0.03, kind: 'sniper',
  },
  shotgun: {
    id: 'shotgun', name: 'SG-12 Breacher', price: 1200, damage: 9, headMult: 2,
    mag: 7, reserve: 28, auto: false, gap: 0.85, reload: 2.6,
    spreadStill: 0.02, spreadMove: 0.045, pellets: 8, kick: 0.02, kind: 'shotgun',
  },
  grenade: {
    id: 'grenade', name: 'HE Charge', price: 300, damage: 95, headMult: 1,
    mag: 1, reserve: 0, auto: false, gap: 0.9, reload: 0,
    spreadStill: 0, spreadMove: 0, pellets: 0, kick: 0.004, kind: 'grenade',
  },
};

export const BUY_ORDER = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'grenade'];

const MODEL_SHAPES = {
  pistol: { receiver: [0.05, 0.07, 0.2], barrel: [0.03, 0.03, 0.14], stock: [0.045, 0.1, 0.07], pos: [0.2, -0.17, -0.42] },
  smg: { receiver: [0.08, 0.09, 0.34], barrel: [0.04, 0.04, 0.24], stock: [0.06, 0.07, 0.16], pos: [0.24, -0.2, -0.42] },
  rifle: { receiver: [0.09, 0.1, 0.42], barrel: [0.045, 0.045, 0.4], stock: [0.075, 0.08, 0.22], pos: [0.24, -0.2, -0.42] },
  sniper: { receiver: [0.09, 0.11, 0.5], barrel: [0.04, 0.04, 0.62], stock: [0.08, 0.09, 0.26], pos: [0.24, -0.2, -0.46] },
  shotgun: { receiver: [0.09, 0.11, 0.44], barrel: [0.06, 0.06, 0.42], stock: [0.08, 0.09, 0.22], pos: [0.24, -0.2, -0.42] },
  grenade: { receiver: [0.09, 0.09, 0.09], barrel: [0.02, 0.05, 0.02], stock: [0.02, 0.02, 0.02], pos: [0.22, -0.18, -0.36] },
};

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  const model = new THREE.Group();
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Per-weapon ammo persists across switches within a round.
  const ammo = {};
  for (const id of Object.keys(WEAPONS)) ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };

  const state = { id: 'pistol', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, grenades: 0 };
  let modelParts = [];

  function buildModel(id) {
    for (const part of modelParts) {
      model.remove(part);
      part.geometry.dispose();
    }
    modelParts = [];
    const shape = MODEL_SHAPES[id];
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(...shape.receiver), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(...shape.barrel), id === 'grenade' ? accent : grip);
    barrel.position.set(0, 0.025, -(shape.receiver[2] / 2 + shape.barrel[2] / 2 - 0.02));
    const stock = new THREE.Mesh(new THREE.BoxGeometry(...shape.stock), grip);
    stock.position.set(0, -0.02, shape.receiver[2] / 2 + shape.stock[2] / 2 - 0.04);
    model.add(receiver, barrel, stock);
    modelParts = [receiver, barrel, stock];
    model.position.set(...shape.pos);
    model.rotation.set(0, 0.1, 0); // a slight angle so the gun reads as a gun, not a plank
  }

  buildModel('pistol');

  function current() {
    return WEAPONS[state.id];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = MODEL_SHAPES[state.id].pos[2] + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = current();
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = ammo[state.id];
        const need = def.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        if (Number.isFinite(slot.reserve)) slot.reserve -= take;
      }
    }
  }

  return {
    state,
    ammo,
    step,
    current,
    def(id) {
      return WEAPONS[id];
    },
    mag() {
      return ammo[state.id].mag;
    },
    reserve() {
      return ammo[state.id].reserve;
    },
    ready() {
      return ammo[state.id].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = current().gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (ammo[state.id].mag <= 0) return false;
      ammo[state.id].mag -= 1;
      return true;
    },
    reload() {
      const def = current();
      const slot = ammo[state.id];
      if (state.reloadLeft > 0 || slot.mag === def.mag || slot.reserve === 0 || def.reload === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed) {
      const def = current();
      return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
    },
    equip(id) {
      if (!WEAPONS[id] || state.id === id) return false;
      state.id = id;
      state.cooldown = Math.max(state.cooldown, 0.25);
      state.reloadLeft = 0;
      buildModel(id);
      return true;
    },
    give(id) {
      const def = WEAPONS[id];
      ammo[id].mag = def.mag;
      ammo[id].reserve = def.reserve;
      if (id === 'grenade') state.grenades += 1;
    },
    has(id) {
      return id === 'pistol' || ammo[id].mag > 0 || ammo[id].reserve > 0 || (id === 'grenade' && state.grenades > 0);
    },
    refill() {
      for (const id of Object.keys(WEAPONS)) {
        ammo[id].mag = WEAPONS[id].mag;
        ammo[id].reserve = WEAPONS[id].reserve;
      }
      state.grenades = 0;
      state.id = 'pistol';
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      buildModel('pistol');
    },
  };
}
