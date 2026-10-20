// Unità di misura del mondo: 1 unità = 1 dm (10 cm). Gravità scalata di conseguenza.
export const G = 98.1;
export const BOX_SIZE = 36;

// Geometria capsula Original (dm): flangia ~3.7 cm, altezza ~2.8 cm
export const CAP = { rTop: 0.185, rBot: 0.135, h: 0.28 };

// 43 gusti, riconoscibili dal colore dell'alluminio
export const FLAVORS = [
  ['Ristretto', '#3a2a2a'], ['Arpeggio', '#4a1f4f'], ['Roma', '#7a4a1a'], ['Livanto', '#d9a441'],
  ['Capriccio', '#2f6b3a'], ['Volluto', '#e8c547'], ['Cosi', '#e9e1c4'], ['Indriya', '#9b2d2d'],
  ['Kazaar', '#1a1a1a'], ['Dharkan', '#5c3b1e'], ['Fortissio', '#a8332c'], ['Vivalto', '#3a59a8'],
  ['Linizio', '#c4d84a'], ['Envivo', '#e07a2a'], ['Bianco Doppio', '#d8d8d8'], ['Scuro', '#2a2f3a'],
  ['Ethiopia', '#8bbf3c'], ['Colombia', '#d4352c'], ['Nicaragua', '#3d8fb5'], ['Peru', '#b5753a'],
  ['Costa Rica', '#2c8c78'], ['Guatemala', '#6f4aa0'], ['Rosabaya', '#c9396a'], ['Dulsao', '#f0b37e'],
  ['Cubania', '#2b4a2b'], ['Tokyo', '#e86a8f'], ['Stockholm', '#7aa9d6'], ['Shanghai', '#f1d15a'],
  ['Caramel', '#c68a3c'], ['Vanilla', '#f2e6b8'], ['Hazelnut', '#8a5a34'], ['Chocolate', '#4c2a1b'],
  ['Ispirazione Roma', '#a4562c'], ['Ispirazione Napoli', '#6b1f1f'], ['Ispirazione Firenze', '#7d9c47'],
  ['Ispirazione Venezia', '#2d6aa0'], ['Ispirazione Genova', '#d97b3a'], ['Ispirazione Palermo', '#e0a33a'],
  ['Decaffeinato', '#5a7a8a'], ['Decaf Intenso', '#3c4f5c'], ['Lungo Leggero', '#9fd0e0'],
  ['Espresso Forte', '#7a1f2f'], ['Limited Ed.', '#ff4fb0'],
];
export const NF = FLAVORS.length; // 43

// ---------------- Layout (dm) ----------------
export const R_TABLE = 4.5;       // raggio posizione slot sulla tavola
export const BELT_W = 3.0;        // larghezza nastro
export const BELT_Y = 1.5;        // quota superficie nastro
export const DECK_Y = 2.0;        // piano delle banchine (pallet)
export const PALLET_H = 1.4;
export const HINGE_Y = DECK_Y + PALLET_H; // quota cerniera cassone = fondo canale vite
export const TROUGH_Y = HINGE_Y - 0.14; // il canale è più basso dello spigolo del fondo: le capsule "cadono" sulla vite invece di incastrarsi
export const BIN_D = 6.0;         // profondità cassone (lungo direzione di scarico)
export const BIN_W = 6.0;         // larghezza cassone (lungo il nastro)
export const BIN_H = 2.4;         // altezza pareti
export const BIN_FRONT = 2.7;     // distanza fronte cassone dall'asse nastro
export const BIN_PITCH = 7.5;     // passo tra cassoni lungo il nastro
export const BIN_FIRST = 17;      // distanza del primo cassone dall'hub
export const BIN_PER_SIDE = 7;
export const BELT_LEN = 68;       // lunghezza utile dal bordo hopper
export const TILT = (30 * Math.PI) / 180;
export const SCREW = { pitch: 0.55, len: 2.3, r: 0.26 };
export const HOPPER_Y = 1.5;

export const defaults = {
  speed: 1,
  autoOrders: true,
  autoRotate: false,
  beltSpeed: 14,      // dm/s
  screwRate: 4.0,     // capsule/s per vite
  scrambleTime: 60,   // s (da specifica)
  deltas: 1,
  pickTime: 0.42,     // s per pick (delta)
  binStock: 400,      // capsule virtuali per cassone prima di AGV
  indexTime: 1.4,
};
