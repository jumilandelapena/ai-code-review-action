/** Minimal logger so the pipeline does not depend on `@actions/core` in tests. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warning(message: string): void;
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warning: () => undefined,
};

export const consoleLogger: Logger = {
  debug: (message) => console.debug(message),
  info: (message) => console.log(message),
  warning: (message) => console.warn(`warning: ${message}`),
};
