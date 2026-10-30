/* Error 404 - Path for incorrect URL paths */  

import { ReactElement } from "react";

/**
 * NotFound Component - Displays a 404 error page for incorrect URL paths.
 * @returns {ReactElement} The 404 error page component.
 */
export function NotFound(): ReactElement {
  return (
    <div>
      <h1>Error 404</h1>
      <h3>This page could not be found :(((</h3>
    </div>
  );
}
