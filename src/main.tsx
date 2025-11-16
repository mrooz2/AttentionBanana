import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App-New";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
