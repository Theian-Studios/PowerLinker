// Small helpers for the page's animations: answers sliding away, ripples on the answer buttons and the like.
// Everything here is decoration, so it does nothing in a browser that can't animate.

/**
 * Whether the person asked their phone or computer to reduce motion; movement then becomes a plain fade.
 * @returns {boolean} True when Reduce Motion is on.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Plays keyframes on an element, if the browser can.
 * @param {Element} element - What to animate.
 * @param {Keyframe[]} keyframes - The frames.
 * @param {KeyframeAnimationOptions} options - Length, easing and the like.
 * @returns {Promise<void>} Settles when the animation ends, right away when it can't play.
 */
export function animate(element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (typeof element.animate !== "function") return Promise.resolve();
  return element.animate(keyframes, options).finished.then(() => undefined, () => undefined);
}
