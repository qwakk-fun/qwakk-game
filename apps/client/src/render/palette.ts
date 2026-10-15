/** Brand colors (the same tokens the app and landing use) plus greybox tones. */
export const BRAND = {
  yellow: 0xffd43b,
  beak: 0xff8a3d,
  dark: 0x151619,
} as const;

export const WORLD_COLORS = {
  sky: 0x9fd7f2,
  fog: 0xbfe3f2,
  water: 0x2fa7c9,
  sand: 0xf1dfa6,
  grass: 0x8cc152,
  grassDark: 0x6aa13f,
  rock: 0x9c9a92,
  wall: 0xf3ecdc,
  floor: 0xd9c9a8,
  roof: BRAND.beak,
  stairs: 0xe9d9b4,
  ramp: BRAND.yellow,
  crate: 0xc58b4a,
  cover: 0xb7b3a6,
  block: 0xffe58a,
  foundation: 0xa9a495,
} as const;
