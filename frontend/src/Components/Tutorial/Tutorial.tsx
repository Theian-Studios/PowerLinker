import { FormEvent, ReactElement, ReactNode, TouchEvent, useEffect, useRef, useState } from "react";
import { STREAK_GOAL, STREAK_POINTS } from "../../Models/Context";
import { MAX_NAME_LENGTH, saveVolunteerName, volunteerName } from "../../Services/sheetsApi";
import "./Tutorial.css";

/** How far a finger has to move sideways before it counts as a swipe, in pixels. */
const SWIPE_PX = 40;
/** Hints in a row shown in the points card's example bar, so it looks partway to the bonus. */
const EXAMPLE_STREAK = 10;

type Status = "ok" | "close" | "bad";
const ICON: Record<Status, string> = { ok: "✓", close: "!", bad: "✕" };

/**
 * A few rows laid out like the hint's comparison table: label, record, tree and icon, with the reason underneath.
 * @param {Object} props - Component props.
 * @param {Array} props.rows - Each row as [label, record, tree, status, reason].
 * @returns {ReactElement} The small table.
 */
function Rows({ rows }: { rows: [string, string, string, Status, string][] }): ReactElement {
  return (
    <div className="intro-table">
      <div className="intro-row intro-row--head" aria-hidden="true">
        <span />
        <span>Record</span>
        <span>Tree</span>
        <span />
      </div>
      {rows.map(([label, record, tree, status, reason], i) => (
        <div key={i} className={`intro-row intro-row--${status}`}>
          <span className="intro-label">{label}</span>
          <span>{record}</span>
          <span>{tree}</span>
          <span className={`intro-icon intro-icon--${status}`} aria-label={status === "ok" ? "Matches" : status === "close" ? "Close" : "Doesn’t match"}>
            {ICON[status]}
          </span>
          <span className={`intro-reason intro-reason--${status}`}>{reason}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The colored heading at the top of the green, yellow and red cards.
 * @param {Object} props - Component props.
 * @param {Status} props.status - Which color.
 * @param {string} props.children - The heading text.
 * @returns {ReactElement} The heading with its icon.
 */
function ColorTitle({ status, children }: { status: Status; children: string }): ReactElement {
  return (
    <h2 className={`intro-title intro-title--${status}`}>
      <span className={`intro-icon intro-icon--${status}`} aria-hidden="true">{ICON[status]}</span>
      {children}
    </h2>
  );
}

/** The six cards, in order. */
const CARDS: ReactNode[] = [
  <div key="why" className="intro-spread">
    <img className="intro-logo" src={`${import.meta.env.BASE_URL}RLL_Logo.png`} alt="" />
    <h2 className="intro-title">Help families find their ancestors</h2>
    <p className="intro-middle">People in historical records are waiting to be reconnected with their families. The right match puts them on the tree.</p>
    <p className="intro-closing"><b>That’s why we need you.</b></p>
  </div>,
  <div key="how" className="intro-spread">
    <h2 className="intro-title">How it works</h2>
    <ol className="intro-steps">
      <li><span>Read the record</span></li>
      <li><span>Compare it with the person on the tree</span></li>
      <li className="intro-step--answers">
        <span>
          Tap
          <span className="intro-choices">
            <span className="intro-pill intro-pill--no">✕ Different</span>
            or
            <span className="intro-pill intro-pill--yes">✓ Same person</span>
          </span>
        </span>
      </li>
    </ol>
    <p className="intro-muted intro-bottom">Can’t tell? <b>Not sure</b> is always OK.</p>
  </div>,
  <>
    <ColorTitle status="ok">Green: go</ColorTitle>
    <Rows rows={[
      ["Name", "Polly", "Mary", "ok", "Nickname"],
      ["Residence", "Salem Township", "Salem", "ok", "Same town"],
    ]} />
    <div className="intro-family">
      <div className="intro-family-head">Family on the record</div>
      <div className="intro-family-line">
        <span className="intro-icon intro-icon--ok" aria-label="Matches">✓</span>
        <span><b>John</b> · husband</span>
      </div>
    </div>
    <p className="intro-verdict intro-verdict--ok">Mostly green → <b>Same person</b></p>
  </>,
  <>
    <ColorTitle status="close">Yellow: slow down</ColorTitle>
    <Rows rows={[
      ["Name", "Ann", "Mary Ann", "close", "Went by her middle name"],
      ["Name", "J. Smith", "John Smith", "close", "Only an initial"],
      ["Birthplace", "Prussia", "Germany", "close", "Border changed"],
    ]} />
    <p className="intro-verdict intro-verdict--close">Usually still <b>the same person</b></p>
  </>,
  <>
    <ColorTitle status="bad">Red: stop and look</ColorTitle>
    <Rows rows={[
      ["Died", "1931", "1913", "bad", "Typo? Digits swapped"],
      ["Birthplace", "Ohio", "Texas", "bad", "Different places"],
    ]} />
    <p className="intro-verdict intro-verdict--bad">1 red → maybe a typo<br />2 or more → <b>Different</b></p>
  </>,
  <>
    <div className="intro-points" aria-hidden="true">
      <div className="intro-points-labels"><span><b>0</b> points</span><span>{STREAK_GOAL - EXAMPLE_STREAK} more for +{STREAK_POINTS}</span></div>
      <div className="intro-points-track"><div className="intro-points-fill" style={{ width: `${(EXAMPLE_STREAK / STREAK_GOAL) * 100}%` }} /></div>
    </div>
    <div className="intro-art" aria-hidden="true">⚡</div>
    <h2 className="intro-title">Earn points</h2>
    <p>{STREAK_GOAL} hints in a row = <b>+{STREAK_POINTS} points</b>.</p>
    <p>Miss a check hint and your streak resets. <b>Not sure</b> never does.</p>
  </>,
];

/**
 * Tutorial Component - A short intro of six cards: why the work matters, how a hint works, what green, yellow and
 * red mean, and how points work. Swipe (or use the arrow keys or the dots) to move between cards; there's no Back
 * button. On a first visit it's the welcome: a last card asks for the volunteer's name, and Skip, Escape or
 * tapping outside jump to that card rather than closing, so the name is always asked once. Opened again from the
 * question-mark button it has no name card, and a ✕, Escape or tapping outside closes it.
 * @param {Object} props - Component props.
 * @param {() => void} props.onClose - Called once the intro is finished or closed.
 * @param {boolean} [props.welcome] - Whether this is the first visit's welcome, which ends by asking for a name.
 * @returns {ReactElement} The intro, over the page.
 */
export default function Tutorial({ onClose, welcome = false }: { onClose: () => void; welcome?: boolean }): ReactElement {
  const [index, setIndex] = useState<number>(0);
  const [name, setName] = useState<string>(volunteerName);
  // How far the cards follow a finger mid-swipe, in pixels
  const [drag, setDrag] = useState<number>(0);
  // Where the finger went down, whether it's going sideways, and how far it has moved; kept in a ref so the
  // end of a quick swipe sees the last move even before it has been drawn
  const touchStart = useRef<{ x: number; y: number; sideways?: boolean; dx: number } | undefined>(undefined);
  const next = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  // Whether a press began outside the box, so a swipe that ends outside it doesn't close it
  const pressedOutside = useRef<boolean>(false);
  // The welcome adds the name card after the six
  const nameIndex = welcome ? CARDS.length : -1;
  const count = welcome ? CARDS.length + 1 : CARDS.length;
  const onNameCard = index === nameIndex;
  const last = index === count - 1;

  /**
   * Moves to a card, staying within the first and last.
   * @param to - The card to show.
   */
  const go = (to: number) => setIndex(Math.max(0, Math.min(count - 1, to)));

  /**
   * Saves the name they typed and starts.
   * @param event - The name form's submission.
   */
  const start = (event: FormEvent) => {
    event.preventDefault();
    saveVolunteerName(name);
    onClose();
  };

  /**
   * Skip, Escape or a tap outside the box. The welcome jumps to its name card first, so the name is always
   * asked; on that card it counts as skipping the name, which isn't asked again.
   */
  const dismiss = () => {
    if (welcome && !onNameCard) {
      go(nameIndex);
      return;
    }
    if (welcome) saveVolunteerName(volunteerName());
    onClose();
  };

  // The main button has focus to start with, so Enter steps through the cards
  useEffect(() => {
    next.current?.focus();
  }, []);

  // On the name card the name box takes focus, without scrolling the cards out of line
  useEffect(() => {
    if (onNameCard) nameInput.current?.focus({ preventScroll: true });
  }, [onNameCard]);

  // Arrow keys move between cards and Escape dismisses, like the swipe and Skip on a phone; arrows typed in the
  // name box stay in the box
  useEffect(() => {
    /**
     * Handles the arrow keys and Escape.
     * @param event - The key that was pressed.
     */
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === "ArrowRight" && !typing) go(index + 1);
      else if (event.key === "ArrowLeft" && !typing) go(index - 1);
      else if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, [index, welcome]);

  /**
   * Starts following a finger.
   * @param event - Where the finger went down.
   */
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, dx: 0 };
  };

  /**
   * Moves the cards with the finger once it's clearly going sideways rather than scrolling.
   * @param event - Where the finger is now.
   */
  const onTouchMove = (event: TouchEvent) => {
    const touchAt = touchStart.current;
    if (!touchAt) return;
    const dx = event.touches[0].clientX - touchAt.x;
    const dy = event.touches[0].clientY - touchAt.y;
    if (touchAt.sideways === undefined && Math.abs(dx) + Math.abs(dy) > 8) touchAt.sideways = Math.abs(dx) > Math.abs(dy);
    if (!touchAt.sideways) return;
    touchAt.dx = dx;
    // Past the first or last card the cards only give a little, so it's clear there's nothing more
    const atEdge = (dx > 0 && index === 0) || (dx < 0 && last);
    setDrag(atEdge ? dx / 4 : dx);
  };

  /**
   * Finishes a swipe: far enough sideways moves one card, otherwise the cards spring back.
   */
  const onTouchEnd = () => {
    const dx = touchStart.current?.dx ?? 0;
    if (dx <= -SWIPE_PX) go(index + 1);
    else if (dx >= SWIPE_PX) go(index - 1);
    setDrag(0);
    touchStart.current = undefined;
  };

  // The welcome's last card asks for the name; Start (the main button) sends this form
  const nameCard = (
    <div className="intro-spread">
      <h2 className="intro-title">Before you start</h2>
      <form id="intro-name-form" className="intro-name" onSubmit={start}>
        <label htmlFor="intro-name">Your name helps the lab see who answered each hint.</label>
        <input
          id="intro-name"
          ref={nameInput}
          className="intro-input"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          spellCheck={false}
          tabIndex={onNameCard ? 0 : -1}
        />
      </form>
      <button type="button" className="intro-skip-name" onClick={dismiss} tabIndex={onNameCard ? 0 : -1}>
        Skip for now
      </button>
    </div>
  );
  const cards = welcome ? [...CARDS, nameCard] : CARDS;

  return (
    <div
      className="intro-overlay"
      onPointerDown={(event) => (pressedOutside.current = event.target === event.currentTarget)}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget) dismiss();
      }}
    >
      <div className="intro-panel" role="dialog" aria-modal="true" aria-roledescription="carousel" aria-label="How PowerLinker works">
        {!welcome && <button type="button" className="intro-close" aria-label="Close" onClick={dismiss}>✕</button>}
        {welcome && !onNameCard && <button type="button" className="intro-skip" onClick={dismiss}>Skip</button>}
        <div className="intro-viewport" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
          <div
            className={`intro-track${drag ? " is-dragging" : ""}`}
            style={{ transform: `translateX(calc(${-index * 100}% + ${drag}px))` }}
          >
            {cards.map((card, i) => (
              <section
                key={i}
                className="intro-card"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}`}
                aria-hidden={i !== index}
              >
                {card}
              </section>
            ))}
          </div>
        </div>
        <div className="intro-dots">
          {cards.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`intro-dot${i === index ? " is-current" : ""}`}
              aria-label={`Card ${i + 1} of ${count}`}
              aria-current={i === index}
              onClick={() => go(i)}
            />
          ))}
        </div>
        {welcome && onNameCard
          ? (
            <button ref={next} type="submit" form="intro-name-form" className="intro-next" disabled={!name.trim()}>
              Start
            </button>
          )
          : (
            <button ref={next} type="button" className="intro-next" onClick={() => (last ? onClose() : go(index + 1))}>
              {index === 0 ? "Show me how" : last ? "Start" : "Next"}
            </button>
          )}
      </div>
    </div>
  );
}
