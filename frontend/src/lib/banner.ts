/** A banner cosmetic washed toward the theme background, so text on top of it stays readable.
 *  `amount` is how much of the background covers it (0 to 100). */
export const dimBanner = (banner: string, amount: number) =>
  `linear-gradient(color-mix(in srgb, var(--color-bg) ${amount}%, transparent) 0 0), ${banner}`;
