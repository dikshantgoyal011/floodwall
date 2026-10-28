import { createBrowserRouter, Navigate } from "react-router";
import App from "./App";
import { ConsoleLayout } from "./components/console/ConsoleLayout";
import { SiteLayout } from "./components/shared/SiteLayout";
import { AUTH_PATHS } from "./constants/auth";
import { CONSOLE_PATHS } from "./constants/console";
import { PRICING_PATH } from "./constants/pricing";
import { AccountPage } from "./pages/AccountPage";
import { HoldPage } from "./pages/console/HoldPage";
import { IntentDetailPage } from "./pages/console/IntentDetailPage";
import { IntentsPage } from "./pages/console/IntentsPage";
import { LedgerPage } from "./pages/console/LedgerPage";
import { NewIntentPage } from "./pages/console/NewIntentPage";
import { OverviewPage } from "./pages/console/OverviewPage";
import { PoliciesPage } from "./pages/console/PoliciesPage";
import { LoginPage } from "./pages/LoginPage";
import { PricingPage } from "./pages/PricingPage";
import { SignupPage } from "./pages/SignupPage";

// "/" is the landing page and /pricing a draft of the plans, both inside the
// site's header and footer. The console under /app is a dummy-data preview.
// /pricing and /app are reachable by URL only (nothing on the landing page
// links to them) and kept out of search. /login, /signup and /account stand
// alone, without the header or footer, and sign in with a one-time code, a
// demo for now (helpers/auth.ts);
// /app sends anyone signed out to /login first.
export const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <App /> },
      { path: PRICING_PATH, element: <PricingPage /> },
    ],
  },
  { path: AUTH_PATHS.login, element: <LoginPage /> },
  { path: AUTH_PATHS.signup, element: <SignupPage /> },
  { path: AUTH_PATHS.account, element: <AccountPage /> },
  {
    path: CONSOLE_PATHS.overview,
    element: <ConsoleLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: CONSOLE_PATHS.intents, element: <IntentsPage /> },
      { path: CONSOLE_PATHS.newIntent, element: <NewIntentPage /> },
      { path: CONSOLE_PATHS.intent(":id"), element: <IntentDetailPage /> },
      { path: CONSOLE_PATHS.hold, element: <HoldPage /> },
      { path: CONSOLE_PATHS.ledger, element: <LedgerPage /> },
      { path: CONSOLE_PATHS.policies, element: <PoliciesPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
