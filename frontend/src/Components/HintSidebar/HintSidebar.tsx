import "./HintSidebar.css";
import { ReactElement, useContext, useEffect, useState } from "react";
import { CompareRow, Status } from "../CompareTable/compareRows";
import { CONTEXT, ContextState, STREAK_GOAL, STREAK_POINTS } from "../../Models/Context";
import useStreakGlow from "../../Hooks/useStreakGlow";
import { CHILE, tr } from "../../Services/region";
import { say, sayValue } from "../../Services/spanish";

export interface PersonRows {
  heading: string;
  rows: CompareRow[];
}

const HELP_OPEN_KEY = "powerlinker.helpOpen";

/** Most items listed under Evidence; the rest are summed up in one line. */
const MAX_ISSUES = 3;

const COUNT_LABELS: Record<Exclude<Status, "none">, [string, string, string]> = {
  ok: ["✓", tr("match", "coincidencia"), tr("matches", "coincidencias")],
  close: ["!", tr("variation", "variación"), tr("variations", "variaciones")],
  bad: ["✕", tr("conflict", "conflicto"), tr("conflicts", "conflictos")],
};

/**
 * Reads whether the help panel was left open; defaults to open.
 * @returns True if the help panel should start open.
 */
function readHelpOpen(): boolean {
  try {
    return localStorage.getItem(HELP_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * SessionProgress Component - The points total, then a bar for answers in a row toward the next bonus.
 * @returns {ReactElement} The progress card.
 */
function SessionProgress(): ReactElement {
  const { context } = useContext(CONTEXT) as ContextState;
  const { glow } = useStreakGlow();
  const done = context.streak;
  const progress = Math.min(1, done / STREAK_GOAL);

  return (
    <section className="side-card progress-card">
      <h2 className="side-title">{tr("Points", "Puntos")}</h2>
      <div className="points-total">{context.points}</div>
      <div className="streak-labels">
        <span><b>{done}</b> {tr("of", "de")} {STREAK_GOAL} {tr("in a row", "seguidas")}</span>
        <span className="streak-bonus">+{STREAK_POINTS}</span>
      </div>
      <div
        className="streak-track"
        role="progressbar"
        aria-label={tr(`Answers in a row toward ${STREAK_POINTS} points`, `Respuestas seguidas para ganar ${STREAK_POINTS} puntos`)}
        aria-valuemin={0}
        aria-valuemax={STREAK_GOAL}
        aria-valuenow={done}
      >
        <div className={`streak-fill${glow ? " is-growing" : ""}`} style={{ width: `${progress * 100}%` }} />
      </div>
      <p className="progress-sub">{tr("Missing a check hint starts the count over.", "Si fallas una pregunta de control, tu racha vuelve a cero.")}</p>
    </section>
  );
}

/**
 * Evidence Component - Summarizes every comparison in the hint: counts, then what to look at.
 * @param props - Component props.
 * @param props.people - Comparison rows for each person, with their heading.
 * @returns {ReactElement} The evidence summary.
 */
function Evidence({ people }: { people: PersonRows[] }): ReactElement {
  const [showAll, setShowAll] = useState<boolean>(false);
  // Each new hint starts with the short list again
  useEffect(() => setShowAll(false), [people]);

  const all = people.flatMap((person) => person.rows);
  const counts = { ok: 0, close: 0, bad: 0 };
  for (const row of all) if (row.status !== "none") counts[row.status] += 1;

  // Conflicts first, then variations
  const issues = people
    .flatMap((person) => person.rows.map((row) => ({ person: person.heading, row })))
    .filter(({ row }) => row.status === "bad" || row.status === "close")
    .sort((a, b) => (a.row.status === b.row.status ? 0 : a.row.status === "bad" ? -1 : 1));

  return (
    <section className="side-card">
      <h2 className="side-title">{tr("Evidence", "Evidencia")}</h2>
      {/* Only the kinds the hint has: "0 conflicts" is noise */}
      <div className="evidence-counts">
        {(["ok", "close", "bad"] as const).filter((status) => counts[status] > 0).map((status) => (
          <span key={status} className={`evidence-count evidence-count--${status}`}>
            <span aria-hidden="true">{COUNT_LABELS[status][0]}</span> {counts[status]} {counts[status] === 1 ? COUNT_LABELS[status][1] : COUNT_LABELS[status][2]}
          </span>
        ))}
      </div>
      {issues.length > 0 && (
        <ul className="evidence-list">
          {(showAll ? issues : issues.slice(0, MAX_ISSUES)).map(({ person, row }, i) => (
            <li key={i} className={`evidence-item evidence-item--${row.status}`}>
              <span className="evidence-icon" aria-hidden="true">{row.status === "bad" ? "✕" : "!"}</span>
              <span className="evidence-text">
                <span className="evidence-what">{people.length > 1 ? `${say(person)} · ` : ""}{say(row.label)}</span>
                {row.reason && <span className="evidence-reason">{say(row.reason)}</span>}
                <span className="evidence-values">{sayValue(row.kind, row.record)} <span className="evidence-vs">vs</span> {sayValue(row.kind, row.tree)}</span>
              </span>
            </li>
          ))}
          {issues.length > MAX_ISSUES && (
            <li className="evidence-more">
              <button type="button" className="evidence-toggle" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
                {showAll ? tr("Show fewer ▴", "Ver menos ▴") : tr(`Show ${issues.length - MAX_ISSUES} more ▾`, `Ver ${issues.length - MAX_ISSUES} más ▾`)}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/**
 * HowToDecide Component - A few tips for deciding, in a panel that can be collapsed and remembers its state.
 * @returns {ReactElement} The help panel.
 */
function HowToDecide(): ReactElement {
  const [open, setOpen] = useState<boolean>(readHelpOpen);

  return (
    <details
      className="side-card help"
      open={open}
      onToggle={(e) => {
        const isOpen = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(isOpen);
        try {
          localStorage.setItem(HELP_OPEN_KEY, String(isOpen));
        } catch {
          // Remembering the panel state is only a convenience
        }
      }}
    >
      <summary className="side-title">{tr("Tips", "Consejos")}</summary>
      {CHILE ? (
        <ul className="help-list">
          <li><b>Dos apellidos.</b> Primero va el del padre y luego el de la madre. Muchos registros antiguos traen solo el paterno, y eso no es una diferencia.</li>
          <li><b>Las mujeres conservaban su apellido.</b> «Pérez de Soto» quiere decir casada con un Soto, no que se llamara Soto.</li>
          <li><b>Muchos usaban su segundo nombre.</b> «María del Carmen» puede aparecer solo como «Carmen».</li>
          <li><b>Hijos naturales.</b> Un hijo de padres no casados puede llevar solo los apellidos de la madre.</li>
          <li><b>«Segundo» y «Tercero» son nombres,</b> no números.</li>
          <li><b>Mira la familia.</b> Muchos lugares dicen solo «Chile», así que los nombres de los padres suelen decidir más que las fechas.</li>
          <li><b>¿Tienes dudas? Elige No sé.</b> Siempre es mejor que adivinar.</li>
        </ul>
      ) : (
      <ul className="help-list">
        <li><b>A matching name isn&apos;t enough.</b> Fathers and sons, and cousins, often share a name. Check the birth years and places.</li>
        <li><b>Small differences are normal.</b> Ages were often guessed, so a year or two off is just a variation. Places can be more or less specific.</li>
        <li><b>Married names change.</b> A woman may appear under her maiden name on one side and her married name on the other.</li>
        <li><b>Look at the family.</b> If the spouse or children don&apos;t line up, it&apos;s probably a different family.</li>
        <li><b>Unsure? Choose Not sure.</b> It&apos;s always better than guessing.</li>
      </ul>
      )}
    </details>
  );
}

/**
 * HintSidebar Component - The desktop sidebar beside the comparison: evidence summary and help.
 * @param props - Component props.
 * @param props.people - Comparison rows for each person in the hint.
 * @returns {ReactElement} The evidence card followed by the help panel.
 */
export default function HintSidebar({ people }: { people: PersonRows[] }): ReactElement {
  return (
    <aside className="hint-sidebar" aria-label={tr("Progress, evidence and tips", "Progreso, evidencia y consejos")}>
      <SessionProgress />
      <Evidence people={people} />
      <HowToDecide />
    </aside>
  );
}
