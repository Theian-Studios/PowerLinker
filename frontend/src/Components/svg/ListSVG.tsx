import { ReactElement } from "react";

/**
 * ListSVG Component - Renders a list icon.
 * @returns {ReactElement} An SVG list icon.
 */
export default function ListSVG(): ReactElement {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -3 22 20">
      <path
        fill="currentColor"
        d="M1 2.9C0.5 2.9 0.1 2.5 0.1 2V1c0-0.5 0.4-0.9 0.9-0.9h1c0.5 0 0.9 0.4 0.9 0.9v1c0 0.5-0.4 0.9-0.9 0.9H1zM6 2.9C5.5 2.9 5.1 2.5 5.1 2V1c0-0.5 0.4-0.9 0.9-0.9h13c0.5 0 0.9 0.4 0.9 0.9v1c0 0.5-0.4 0.9-0.9 0.9H6zM1 8.9C0.5 8.9 0.1 8.5 0.1 8V7c0-0.5 0.4-0.9 0.9-0.9h1c0.5 0 0.9 0.4 0.9 0.9v1c0 0.5-0.4 0.9-0.9 0.9H1zM6 8.9C5.5 8.9 5.1 8.5 5.1 8V7c0-0.5 0.4-0.9 0.9-0.9h13c0.5 0 0.9 0.4 0.9 0.9v1c0 0.5-0.4 0.9-0.9 0.9H6zM1 14.9c-0.5 0-0.9-0.4-0.9-0.9v-1c0-0.5 0.4-0.9 0.9-0.9h1c0.5 0 0.9 0.4 0.9 0.9v1c0 0.5-0.4 0.9-0.9 0.9H1zM6 14.9c-0.5 0-0.9-0.4-0.9-0.9v-1c0-0.5 0.4-0.9 0.9-0.9h13c0.5 0 0.9 0.4 0.9 0.9v1c0 0.5-0.4 0.9-0.9 0.9H6z"
      />
      <rect fill="none" width="20" height="15" />
    </svg>
  );
}
