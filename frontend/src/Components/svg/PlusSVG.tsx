import { ReactElement } from "react";

/**
 * PlusSVG Component - Renders a plus icon.
 * @returns {ReactElement} An SVG plus icon.
 */
export default function PlusSVG(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      viewBox="5 5 14 14"
      fill="currentColor"
    >
      <path d="M18 11h-5V6h-2v5H6v2h5v5h2v-5h5z" fillRule="evenodd"></path>
    </svg>
  );
}
