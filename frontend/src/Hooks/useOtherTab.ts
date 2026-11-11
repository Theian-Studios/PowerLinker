import { useEffect, useState } from "react";
import { CHILE } from "../Services/region";
import { v4 } from "uuid";
import { usingSheets } from "../Services/sheetsApi";

// The Chilean site, on the same address, keeps its own, so opening it doesn't pause an English tab
const TAB_KEY = CHILE ? "powerlinker.tab.cl" : "powerlinker.tab";

/**
 * Notices when the app is opened in another tab of this browser. Both tabs would start from the same saved place
 * and show the same hints, so the newest tab takes over and the others step aside.
 * @returns {boolean} True once another tab has opened the app.
 */
export default function useOtherTab(): boolean {
  const [otherTab, setOtherTab] = useState<boolean>(false);

  useEffect(() => {
    if (!usingSheets) return;
    const id = v4();
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      // Without storage, tabs can't tell each other apart; each carries on as before
      return;
    }
    /**
     * Another tab writing its ID means it has just opened.
     * @param event - A change to storage made by another tab.
     */
    const changed = (event: StorageEvent) => {
      if (event.key === TAB_KEY && event.newValue && event.newValue !== id) setOtherTab(true);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  return otherTab;
}
