import { ReactElement } from "react";

/**
 * CheckmarkSVG Component - Renders a checkmark icon.
 * @returns {ReactElement} An SVG checkmark icon.
 */
export default function Checkmark(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      viewBox="2 2 19 19"
      fill="currentColor"
    >
      <path d="M8.22 15.76l-4.22-4-1.5 1.32 5.72 5.42L20.5 6.87 19.06 5.5z"></path>
    </svg>
  );
}
