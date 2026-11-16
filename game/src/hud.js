// The DOM HUD: crosshair, hit marker, health, armour, ammo, money, timer,
// score, alive counts, kill feed, round banner and the buy menu. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out.
import { WEAPONS, BUY_ORDER } from './weapon.js';

const OVERLAY_COPY = {
  start: {
    title: 'IRONLINE PROTOCOL',
    copy: 'Tactical FPS: plant the charge at SITE A or eliminate the RUST team. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'IRONLINE PROTOCOL',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthValue = $('health-value');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const aliveAlly = $('alive-ally');
  const aliveFoe = $('alive-foe');
  const feed = $('killfeed');
  const banner = $('banner');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};

  function setText(el, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      el.textContent = value;
    }
  }

  return {
    setHealth(hp, armor) {
      setText(healthValue, 'hp', String(Math.max(0, Math.ceil(hp))));
      setText(armorValue, 'armor', String(Math.max(0, Math.ceil(armor))));
      healthValue.parentElement.classList.toggle('low', hp <= 30);
    },
    setMoney(money) {
      setText(moneyValue, 'money', `$${money}`);
      setText(buyMoney, 'buyMoney', `$${money}`);
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', Number.isFinite(reserve) ? `/ ${reserve}` : '/ ∞');
      setText(weaponName, 'wname', name);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerValue, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      timerValue.parentElement.classList.toggle('buy-phase', phase === 'buy');
      timerValue.parentElement.classList.toggle('bomb-phase', phase === 'bomb');
    },
    setScore(ally, foe) {
      setText(scoreValue, 'score', `${ally} — ${foe}`);
    },
    setAlive(ally, foe) {
      setText(aliveAlly, 'aliveA', `IRON ${ally}`);
      setText(aliveFoe, 'aliveF', `RUST ${foe}`);
    },
    setCrosshair(spreadPx) {
      const gap = Math.round(4 + spreadPx * 260);
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    addKill(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      feed.prepend(line);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    showBanner(text, sub, holdMs = 2600) {
      banner.innerHTML = '';
      const main = document.createElement('div');
      main.className = 'banner-main';
      main.textContent = text;
      const subEl = document.createElement('div');
      subEl.className = 'banner-sub';
      subEl.textContent = sub;
      banner.append(main, subEl);
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    clearBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('on');
    },
    showPlant(progress, label) {
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
      plantLabel.textContent = label;
    },
    hidePlant() {
      plantBar.hidden = true;
    },
    buildBuyMenu(onBuy) {
      buyList.innerHTML = '';
      BUY_ORDER.forEach((id, i) => {
        const def = WEAPONS[id];
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.dataset.weapon = id;
        row.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${def.name}</span><span class="buy-desc">${def.damage} dmg · ${def.mag} rnd${id === 'grenade' ? ' · throwable' : ''}</span><span class="buy-price">$${def.price}</span>`;
        row.addEventListener('click', () => onBuy(id));
        buyList.appendChild(row);
      });
      // Armor is not a weapon: its own row, key 7.
      const armorRow = document.createElement('button');
      armorRow.type = 'button';
      armorRow.className = 'buy-row';
      armorRow.dataset.weapon = 'armor';
      armorRow.innerHTML = '<span class="buy-key">7</span><span class="buy-name">Kevlar Armor</span><span class="buy-desc">50 armor · absorbs half of incoming damage</span><span class="buy-price">$650</span>';
      armorRow.addEventListener('click', () => onBuy('armor'));
      buyList.appendChild(armorRow);
    },
    markOwned(owned) {
      for (const row of buyList.children) {
        const id = row.dataset.weapon;
        row.classList.toggle('owned', owned.has(id));
      }
    },
    showBuy(show) {
      buyMenu.hidden = !show;
    },
    showOverlay(mode, detail = '') {
      const text = OVERLAY_COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'matchEnd' ? detail : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
