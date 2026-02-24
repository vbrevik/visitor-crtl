import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DualMockConvexProvider } from "./mock-convex";
import { AuthProvider } from "./auth/AuthProvider";
import { oidcConfig } from "./auth/config";
import { App } from "./App";

const unclassUrl = import.meta.env.VITE_CONVEX_UNCLASS_URL ?? "http://localhost:3210";
const restrictedUrl = import.meta.env.VITE_CONVEX_RESTRICTED_URL ?? "http://localhost:3211";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider config={oidcConfig}>
      <DualMockConvexProvider
        unclassUrl={unclassUrl}
        restrictedUrl={restrictedUrl}
      >
        <App />
      </DualMockConvexProvider>
    </AuthProvider>
  </StrictMode>,
);
