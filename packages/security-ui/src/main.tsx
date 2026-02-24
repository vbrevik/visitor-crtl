import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MockConvexProvider } from "./mock-convex";
import { AuthProvider } from "./auth/AuthProvider";
import { oidcConfig } from "./auth/config";
import { App } from "./App";

const convexUrl = import.meta.env.VITE_CONVEX_URL ?? "http://localhost:3211";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider config={oidcConfig}>
      <MockConvexProvider url={convexUrl}>
        <App />
      </MockConvexProvider>
    </AuthProvider>
  </StrictMode>,
);
