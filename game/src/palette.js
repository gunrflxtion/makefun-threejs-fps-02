// The look plan, in one place: one dusk-industrial palette for the whole game.
// canvas = sky/ground haze, surface = concrete, hairline = dark steel, ink = pale
// signage, muted = cool grey-blue, accent = safety orange, danger = alarm red,
// ally = team blue, foe = team rust-red. index.html's CSS uses the same names.
export const PALETTE = {
  canvas: '#171a20',
  surface: '#232830',
  hairline: '#31363f',
  ink: '#e8e4d8',
  muted: '#8b98a5',
  accent: '#ff8c1a',
  danger: '#e5484d',
  ally: '#3fa7ff',
  foe: '#ff5a3c',
};

export function hex(name) {
  return PALETTE[name];
}
