import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setupMockEnvironment } from "./services/mockHandler";

// Automatically activate mock data if running in a standard web browser (for demos and screenshots)
setupMockEnvironment();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
