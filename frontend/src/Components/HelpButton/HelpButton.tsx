import { ReactElement, useState } from "react";
import Tutorial from "../Tutorial/Tutorial";
import "./HelpButton.css";

/**
 * HelpButton Component - A question mark in a circle in the header's top-left corner that opens the short intro
 * again, for anyone who skipped it or wants a reminder of what the colors mean.
 * @returns {ReactElement} The button, and the intro while it's open.
 */
export default function HelpButton(): ReactElement {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <>
      <button type="button" className="help-button" aria-label="How PowerLinker works" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M10.1 10a1.95 1.95 0 1 1 2.8 1.8c-.55.3-.95.7-.95 1.35v.3" />
          <circle className="help-dot" cx="12" cy="15.8" r="0.3" />
        </svg>
      </button>
      {open && <Tutorial onClose={() => setOpen(false)} />}
    </>
  );
}
