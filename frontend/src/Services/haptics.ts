// Small taps of vibration for buttons and moments like finishing a streak.
// Android browsers support the Vibration API. Safari on iPhone doesn't, but since iOS 18 toggling a
// native switch control gives a light tap, so that's the fallback (it only works from a tap).
// Desktop browsers do nothing.

export type Haptic = "tap" | "warning" | "success" | "error";

/** Vibration patterns in milliseconds: on, off, on, ... */
const PATTERNS: Record<Haptic, number[]> = {
  tap: [10],
  warning: [20, 60, 20],
  success: [15, 60, 15, 60, 40],
  error: [60],
};

let iosSwitch: HTMLLabelElement | undefined;

/**
 * Builds a hidden iOS switch whose label can be clicked to get a system tap.
 * @returns The label to click, or undefined outside the browser.
 */
function getIosSwitch(): HTMLLabelElement | undefined {
  if (iosSwitch || typeof document === "undefined") return iosSwitch;
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  iosSwitch = label;
  return label;
}

/**
 * Plays a short vibration where the device supports it.
 * @param kind - The feel: a light tap, a warning, a success or an error.
 */
export function haptic(kind: Haptic = "tap") {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[kind]);
      return;
    }
    // iPhone: one tap per click of the switch; a success or warning gets two
    const label = getIosSwitch();
    if (!label) return;
    label.click();
    if (kind === "success" || kind === "warning") setTimeout(() => label.click(), 90);
  } catch {
    // Haptics are a nicety; never let them break a button
  }
}
