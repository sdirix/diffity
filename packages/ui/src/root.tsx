import { useEffect, useRef } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigation, useRouteError } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import NProgress from "nprogress";
import { queryClient } from "./lib/query-client";
import { ErrorPage } from "./components/error-page";
import { CommandPalette } from "./components/layout/command-palette";
import { SettingsDialog } from "./components/settings/settings-dialog";
import { AgentLayer } from "./components/agent/agent-layer";
import { PageSkeleton } from "./components/layout/skeleton";
import { APPLY_STORED_COLOURS } from "./lib/preferences";
import "./lib/diff-palette";
import "nprogress/nprogress.css";
import "./styles/app.css";

export function Layout(props: { children: React.ReactNode }) {
  const { children } = props;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>diffity</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <script dangerouslySetInnerHTML={{ __html: APPLY_STORED_COLOURS }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function NavigationProgress() {
  const navigation = useNavigation();
  const active = useRef(false);

  useEffect(() => {
    NProgress.configure({ showSpinner: false, minimum: 0.2, trickleSpeed: 100 });
  }, []);

  useEffect(() => {
    if (navigation.state === "loading" && !active.current) {
      active.current = true;
      NProgress.start();
    } else if (navigation.state === "idle" && active.current) {
      active.current = false;
      NProgress.done();
    }
  }, [navigation.state]);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProgress />
      <Outlet />
      <CommandPalette />
      <SettingsDialog />
      <AgentLayer />
      <Toaster
        position="bottom-right"
        gap={8}
        swipeDirections={["right"]}
        toastOptions={{
          style: {
            background: "var(--color-bg-secondary)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-md)",
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
            padding: "10px 12px",
          },
          classNames: {
            description: "!text-text-secondary !text-xs",
            actionButton: "!bg-accent !text-white hover:!bg-accent-hover !h-6 !px-2 !rounded-md !text-xs !font-medium",
            cancelButton: "!bg-transparent !text-text-secondary hover:!bg-hover hover:!text-text !h-6 !px-2 !rounded-md !text-xs !font-medium",
          },
        }}
      />
    </QueryClientProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  return (
    <ErrorPage
      error={error}
      actions={[
        { label: "Reload page", primary: true, onClick: () => window.location.reload() },
        { label: "Go to diff view", onClick: () => { window.location.href = "/diff"; } },
      ]}
    />
  );
}

export function HydrateFallback() {
  return <PageSkeleton />;
}
