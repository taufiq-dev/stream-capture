import { createRoot } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import App from "./app";
import { GlobalStyle } from "./app.styles";
import { theme } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// No <StrictMode>: its dev-only double mount opens the camera twice in parallel, and the first
// (discarded) run can write the camera cache before the second one reads it — which would make the
// cached / scored sessions below non-deterministic.
createRoot(root).render(
  <ThemeProvider theme={theme}>
    <GlobalStyle />
    <App />
  </ThemeProvider>,
);
