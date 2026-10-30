import { ReactElement } from "react";

/**
 * XMarkSVG Component - Renders an X (close) icon.
 * @returns {ReactElement} An SVG X mark icon.
 */
export default function XMark(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      viewBox="4 4 16 16"
      fill="currentColor"
    >
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
    </svg>
  );
}
