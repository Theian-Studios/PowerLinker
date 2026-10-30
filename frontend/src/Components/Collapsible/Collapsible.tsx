import "./Collapsible.css";
import { ReactElement } from "react";

/**
 * Collapsible Component - Creates the collapsible for the match table.
 * @param {Object} props - Component props.
 * @param {boolean} props.open - Boolean to check whether the collapsible is open or closed.
 * @param {ReactElement} props.children - The content to be displayed inside the collapsible section.
 * @returns {ReactElement} The rendered collapsible component.
 */
export default function Collapsible({
  open,
  children,
}: {
  open: boolean;
  children: ReactElement;
}) {
  return (
    <div className={"collapsible-outer" + (open ? " open" : "")}>
      <div className="collapsible-inner">{children}</div>
    </div>
  );
}
