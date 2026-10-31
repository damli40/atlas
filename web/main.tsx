import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ensureRendererStyle } from "./drawing/Drawing";
import "./styles.css";
import "./machines/machines.css";
import "./drawing/drawing.css";
import "./screens/proof.css";

ensureRendererStyle();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
