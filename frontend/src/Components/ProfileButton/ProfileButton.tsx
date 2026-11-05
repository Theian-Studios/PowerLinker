import { FormEvent, useContext, useEffect, useRef, useState } from "react";
import { CONTEXT, ContextState } from "../../Models/Context";
import { MAX_NAME_LENGTH, saveVolunteerName, shouldAskName, volunteerName } from "../../Services/sheetsApi";
import Tutorial from "../Tutorial/Tutorial";
import "./ProfileButton.css";

/**
 * ProfileButton Component - A person icon in the header that opens a small profile panel: points and hints
 * answered all time in this browser, and the volunteer's name, which goes with each answer so the lab knows
 * who did which records. On a first visit to the public site the short intro opens by itself as a welcome,
 * and it ends by asking for the name.
 * @returns {JSX.Element} The button, and the panel while it's open.
 */
export default function ProfileButton() {
  // A first visit opens the intro as a welcome; the name is only asked once
  const [welcome, setWelcome] = useState<boolean>(shouldAskName);
  const [open, setOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>(volunteerName);
  const [saved, setSaved] = useState<boolean>(false);
  const input = useRef<HTMLInputElement>(null);
  const { context } = useContext(CONTEXT) as ContextState;

  /**
   * Closes the panel.
   */
  const close = () => setOpen(false);

  // Escape closes the panel, like other popups
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    /**
     * Closes the panel on Escape.
     * @param event - The key that was pressed.
     */
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * Opens the panel with the saved name.
   */
  const openPanel = () => {
    setName(volunteerName());
    setSaved(false);
    setOpen(true);
  };

  /**
   * Saves the name. An empty name isn't saved; the Enter button is off until they type one.
   * @param event - The form submission.
   */
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    saveVolunteerName(name);
    setName(volunteerName());
    setSaved(true);
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
        <div className="profile-overlay" onClick={close}>
          <form
            className="profile-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={save}
          >
            <div className="profile-head">
              <h2 id="profile-title">Profile</h2>
              <button type="button" className="profile-close" aria-label="Close" onClick={close}>✕</button>
            </div>
            <dl className="profile-stats">
              <div className="profile-stat">
                <dt>Points</dt>
                <dd>{context.points.toLocaleString()}</dd>
              </div>
              <div className="profile-stat">
                <dt>Hints answered</dt>
                <dd>{context.answered.toLocaleString()}</dd>
              </div>
            </dl>
            <p className="profile-note">All time, on this device.</p>
            <label className="profile-label" htmlFor="profile-name">
              Your name
            </label>
            <div className="profile-row">
              <input
                id="profile-name"
                ref={input}
                className="profile-input"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                autoComplete="name"
                spellCheck={false}
              />
              <button type="submit" className="profile-save" disabled={!name.trim()}>
                Enter
              </button>
            </div>
            {saved && <p className="profile-message profile-message--accepted" role="status">Saved.</p>}
          </form>
        </div>
      )}
      {welcome && <Tutorial welcome onClose={() => setWelcome(false)} />}
    </>
  );
}
