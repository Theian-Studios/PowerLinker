import { Routes, Route } from "react-router-dom";
import "./App.css";
import { Layout } from "./Layout/Layout";
import Home from "./Pages/Home/Home"; //CHANGE ME when we are done with purely NUMIDENT
import { NotFound } from "./Pages/NotFound/NotFound";
import { CONTEXT, Context, getInitialContext } from "./Models/Context";
import { useState, ReactNode, useEffect } from "react";
// import { Upload } from "./Pages/Upload/Upload";

/* Establish The Paths - <Route path="/" element=<Layout/>}>, the layout(header, footer, navbar) is always on screen   */  

/**
 * Provider component to initialize the context for the app.
 * @param param Children components to be wrapped by the context provider.
 * @returns {JSX.Element} The context provider wrapping the children components.
 */
function ContextProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<Context>({
    sid: "",
    hintQue: [],
    reviewedHints: [],
    strikes: 0,
    streak: 0,
    points: 0
  });

  useEffect(() => {
    if (context.sid === "") {
      getInitialContext().then((initialContext: Context) => {
        setContext(initialContext);
      });
    }
  }, [context.sid, setContext]);

  return (
    <CONTEXT.Provider value={{ context, setContext }}>
      {children}
    </CONTEXT.Provider>
  );
}

/**
 * Main application component that sets up routing and layout structure.
 * @returns {JSX.Element} The rendered application with routing configuration.
 */
function App() {
  return (
    <div className="App">
      <ContextProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            {/* <Route path="upload" element={<Upload/>} />  not needed anymore*/ } 
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ContextProvider>
    </div>
  );
}

export default App;
