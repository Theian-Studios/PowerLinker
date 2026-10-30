declare global {
  namespace NodeJS {
    interface ProcessEnv {
      REACT_APP_LAMBDA_URL: string;
      REACT_APP_GROWTH_SPURT_URL: string;
      GROWTH_SPURT_PATH: string;
      GROWTH_SPURT_VENV_PATH: string;
    }
  }
}

// If this file has no import/export statements (i.e. is a script)
// convert it into a module by adding an empty export statement.
export {};
