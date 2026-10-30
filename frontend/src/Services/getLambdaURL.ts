import { SHEETS_URL } from "./sheetsApi"

/**
 * Returns whether the app is running against a local backend: on this computer, or opened from
 * another device on the same Wi-Fi (a private network address like 192.168.1.20), as when testing on a phone.
 * @returns {boolean} True when served from localhost, 127.0.0.1 or a private network address.
 */
function isLocal(): boolean {
    const host = window.location.hostname
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")
        || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
}

/**
 * Gets the appropriate Lambda URL based on the current environment.
 * @returns {string} The Lambda API URL for the current environment.
 */
export default function getLambdaURL(path: string): string {
    // The public site: the Sheet's script takes the same query string, without the /hints path
    if (SHEETS_URL) return SHEETS_URL + path.slice(path.indexOf("?") === -1 ? path.length : path.indexOf("?"))
    const host = window.location.hostname
    if (host.endsWith("rll-dev.byu.edu"))
        return "https://api.powerlinker.rll-dev.byu.edu" + path
    if (host.endsWith("rll.byu.edu"))
        return "https://api.powerlinker.rll.byu.edu" + path
    // Anywhere else is local development: talk to the mock, never production. The page's own hostname
    // keeps cookies same-site (localhost and 127.0.0.1 are different sites)
    return `http://${host}:8000` + path
}

/**
 * Gets the fetch credentials mode for API calls. Only the local mock backend uses the voter cookie,
 * so deployed environments keep omitting credentials until the real backend supports it.
 * @returns {RequestCredentials} "include" locally, otherwise "omit".
 */
export function getLambdaCredentials(): RequestCredentials {
    // The Sheet's script can't accept cookies from another site; it gets a voter ID in the request instead
    if (SHEETS_URL) return "omit"
    return isLocal() ? "include" : "omit"
}
