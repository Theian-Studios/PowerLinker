import { ComponentProps, useEffect, useState } from "react";
import "./Loading.css";

const LOADING_DELAY = 250;

/**
 * Loading Component - Displays a loading spinner with an optional message after a short delay.
 * @param {Object} props - The props for the component.
 * @param {string} [props.message] - Optional message to display below the loading spinner.
 * @param {string} [props.className] - Optional additional CSS class names.
 * @returns {JSX.Element | null} The loading component or null if not visible.
 */
export function Loading({
  message,
  className,
  ...props
}: {
  message?: string;
} & ComponentProps<"div">) {
  const [visible, setVisible] = useState<boolean>(false);
  useEffect(() => {
    const timeout = setTimeout(() => setVisible(true), LOADING_DELAY);
    return () => clearTimeout(timeout);
  }, []);

  return visible ? (
    <div
      className={
        "loader" +
        (visible ? " visible" : "") +
        (className ? " " + className : "")
      }
      {...props}
    >
      <div className="loading-ring">
        <div></div>
        <div></div>
        <div></div>
        <div></div>
      </div>
      <div className="loading-text">{message}</div>
    </div>
  ) : null;
}
