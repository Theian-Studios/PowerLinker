import { ReactElement } from "react";

/**
 * NewWindowLink Component - Creates a button that opens a URL in a new window.
 * @param {Object} props - Component props.
 * @param {string} props.url - The URL of the page to open in a new window.
 * @param {string} props.linkName - The text to display on the button.
 * @returns {ReactElement} A button component that opens the specified URL in a new window.
 */
export default function NewWindowLink({
  url,
  linkName,
}: {
  url: string;
  linkName: string;
}): ReactElement {

  /**
   * Handles the button click event to open the URL in a new window.
   * Opens the specified URL in a new browser tab with security features enabled.
   */
  const handleClick = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <button onClick={handleClick} type="button" className="outlined">
      {linkName}
    </button>
  );
};
