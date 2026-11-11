/* Error 404 - Path for incorrect URL paths */  

import { ReactElement } from "react";
import { tr } from "../../Services/region";

/**
 * NotFound Component - Displays a 404 error page for incorrect URL paths.
 * @returns {ReactElement} The 404 error page component.
 */
export function NotFound(): ReactElement {
  return (
    <div>
      <h1>Error 404</h1>
      <h3>{tr("This page could not be found :(((", "No se encontró esta página :(((")}</h3>
    </div>
  );
}
