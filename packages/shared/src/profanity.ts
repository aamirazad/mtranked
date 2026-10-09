import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

// English word list plus transformers that see through leetspeak, look-alike
// characters and repeated letters, while whitelisting innocent words that
// contain a bad one (Scunthorpe, assassin, therapist, ...).
const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

/** Single characters spelled out with separators ("f_u_c_k", "c.u.n.t") joined back up. */
const SPELLED_OUT = /(?<![^\s_.-])([a-z0-9])[\s_.-]+(?=[a-z0-9](?![^\s_.-]))/gi;

/** True if a player-chosen name (display, guest or room name) contains profanity or slurs. */
export function isOffensiveName(text: string): boolean {
  return matcher.hasMatch(text) || matcher.hasMatch(text.replace(SPELLED_OUT, "$1"));
}

export const OFFENSIVE_NAME_MESSAGE = "Please choose a different name.";
