import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/rubik/400.css";
import "@fontsource/rubik/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/tables.css";
import { App } from "./app";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);