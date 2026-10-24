// Glicko-2 (Glickman, 2012). Each ranked race is treated as one rating period.
const SCALE = 173.7178;
const TAU = 0.5;
const EPS = 0.000001;

export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOL = 0.06;
const MIN_RD = 30;

export type Glicko = { rating: number; rd: number; vol: number };
export type GameResult = { opponent: Glicko; score: 0 | 0.5 | 1 };

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muj: number, phij: number) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

export function rate(player: Glicko, games: GameResult[]): Glicko {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;

  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: Math.min(DEFAULT_RD, phiStar * SCALE), vol: sigma };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const { opponent, score } of games) {
    const muj = (opponent.rating - 1500) / SCALE;
    const phij = opponent.rd / SCALE;
    const e = E(mu, muj, phij);
    vInv += g(phij) ** 2 * e * (1 - e);
    deltaSum += g(phij) * (score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // New volatility via the Illinois algorithm.
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPS) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: newMu * SCALE + 1500,
    rd: Math.max(MIN_RD, Math.min(DEFAULT_RD, newPhi * SCALE)),
    vol: newSigma,
  };
}

/** Season reset: pull rating partway to 1500 and raise uncertainty. */
export function seasonReset(p: Glicko, params: { pull: number; rd: number } = { pull: 0.5, rd: 250 }): Glicko {
  return {
    rating: 1500 + (p.rating - 1500) * (1 - params.pull),
    rd: Math.max(p.rd, params.rd),
    vol: DEFAULT_VOL,
  };
}
