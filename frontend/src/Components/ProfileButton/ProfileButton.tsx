import { FormEvent, useEffect, useRef, useState } from "react";
import { submitProfileCode } from "../../Hooks/useLambdaFetch";
import "./ProfileButton.css";

type Status = "idle" | "sending" | "accepted" | "rejected" | "error";

/** What to tell them after they send a code. */
const MESSAGES: Partial<Record<Status, string>> = {
  accepted: "Code accepted.",
  rejected: "That code didn't work.",
  error: "Couldn't reach the server. Try again.",
};

/**
 * ProfileButton Component - A person icon in the header that opens a small profile panel for entering a code.
 * The code is checked by the backend; nothing else in the app changes with it.
 * @returns {JSX.Element} The button, and the panel while it's open.
 */
export default function ProfileButton() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const input = useRef<HTMLInputElement>(null);

  // Escape closes the panel, like other popups
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    /**
     * Closes the panel on Escape.
     * @param event - The key that was pressed.
     */
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * Opens the panel fresh, without the last code or message.
   */
  const openPanel = () => {
    setCode("");
    setStatus("idle");
    setOpen(true);
  };

  /**
   * Sends the code to the backend and shows whether it worked.
   * @param event - The form submission.
   */
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim() || status === "sending") return;
    setStatus("sending");
    const accepted = await submitProfileCode(code);
    setStatus(accepted === undefined ? "error" : accepted ? "accepted" : "rejected");
  };

  return (
    <>
      <button type="button" className="profile-button" aria-label="Profile" aria-haspopup="dialog" onClick={openPanel}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8.5" r="3.6" />
          <path d="M4.8 19.5c1.3-3.3 4-5 7.2-5s5.9 1.7 7.2 5" />
        </svg>
      </button>
      {open && (
        <div className="profile-overlay" onClick={() => setOpen(false)}>
          <form
            className="profile-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={send}
          >
            <div className="profile-head">
              <h2 id="profile-title">Profile</h2>
              <button type="button" className="profile-close" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <label className="profile-label" htmlFor="profile-code">Have a code? Enter it here.</label>
            <div className="profile-row">
              <input
                id="profile-code"
                ref={input}
                className="profile-input"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  if (status !== "sending") setStatus("idle");
                }}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
              <button type="submit" className="profile-save" disabled={!code.trim() || status === "sending"}>
                {status === "sending" ? "Saving…" : "Save"}
              </button>
            </div>
            {MESSAGES[status] && (
              <p className={`profile-message profile-message--${status}`} role="status">{MESSAGES[status]}</p>
            )}
          </form>
        </div>
      )}
    </>
  );
}
