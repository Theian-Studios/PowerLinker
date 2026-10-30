import { useEffect, useReducer, useRef } from "react";

/**
 * Interface representing the state of a fetch request.
 * @template T - The type of data expected from the API response.
 */
export interface State<T> {
  /** The data returned from the API, if successful. */
  data?: T;
  /** Any error that occurred during the fetch request. */
  error?: Error;
  consumed?: boolean;
}

/** Cache type for storing fetched data by URL. */
type Cache<T> = { [url: string]: T };

/**
 * Union type representing possible actions in the fetch reducer.
 * @template T - The type of data expected from the API response.
 */
type Action<T> =
  | { type: "loading" }
  | { type: "fetched"; payload: T }
  | { type: "error"; payload: Error };

/**
 * Custom hook for making fetch requests with caching and error handling.
 * @template T - The type of data expected from the API response.
 * @param {string} [url] - The URL to fetch data from.
 * @param {RequestInit} [options] - Options for the fetch request.
 * @returns {State<T>} A state object containing the fetched data or error.
 */
export function useFetch<T = unknown>(
  url?: string,
  options?: RequestInit
): State<T> {
  const cache = useRef<Cache<T>>({});

  // Used to prevent state update if the component is unmounted
  const cancelRequest = useRef<boolean>(false);

  const initialState: State<T> = {
    error: undefined,
    data: undefined
  };

  /**
   * Reducer function to manage fetch state transitions.
   * @param {State<T>} state - The current state.
   * @param {Action<T>} action - The action to perform.
   * @returns {State<T>} The updated state after applying the action.
   */
  const fetchReducer = (state: State<T>, action: Action<T>): State<T> => {
    switch (action.type) {
      case "loading":
        return { ...initialState };
      case "fetched":
        return { ...initialState, data: action.payload };
      case "error":
        return { ...initialState, error: action.payload };
      default:
        return state;
    }
  };

  const [state, dispatch] = useReducer(fetchReducer, initialState);

  //console.log("useFetch called with:", { url, options });

  useEffect(() => {
    //console.log("useFetch useEffect triggered with url:", url);
    // Do nothing if the url is not given
    if (!url) return;

    cancelRequest.current = false;

    /**
     * Asynchronously fetches data from the provided URL and updates state.
     * Handles caching and error management.
     */
    const fetchData = async () => {
      dispatch({ type: "loading" });
      //console.log ("useFetch loading");

      // If a cache exists for this url, return it
      if (cache.current[url]) {
        dispatch({ type: "fetched", payload: cache.current[url] });
        //console.log ("useFetch fetched from cache");
        return;
      }

      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          //console.log("useFetch failed response");
          throw new Error(response.statusText);
        }

        const data = (await response.json()) as T;
        cache.current[url] = data;
        if (cancelRequest.current) return;

        dispatch({ type: "fetched", payload: data });
        //console.log("useFetch fetched");
      } catch (error) {
        if (cancelRequest.current) return;

        dispatch({ type: "error", payload: error as Error });
        //console.log("useFetch error");
      }
    };

    void fetchData();

    // Use the cleanup function for avoiding a possibly...
    // ...state update after the component was unmounted
    return () => {
      cancelRequest.current = true;
    };
  }, [url, options]);

  return state;
}
