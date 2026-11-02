import { useEffect, useState } from "react";
import { isOnline } from "../Services/network";

/**
 * Follows whether the browser is online.
 * @returns {boolean} False while the browser knows it's offline.
 */
export default function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(isOnline);

  useEffect(() => {
    /**
     * Picks up a change in the connection.
     */
    const update = () => setOnline(isOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
