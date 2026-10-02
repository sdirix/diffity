import { useEffect } from "react";
import { useRouteError, useNavigate, useLocation } from "react-router";
import type { Route } from "./+types/diff";
import { queryClient } from "../lib/query-client";
import { diffOptions } from "../queries/diff";
import { repoInfoOptions } from "../queries/info";
import { refOptions, statusOptions } from "../queries/refs";
import { parseCommitRef } from "../lib/refs";
import { readViewState, rememberLocation } from "../lib/view-state";
import { DiffPage } from "../components/diff/diff-page";
import { ErrorPage } from "../components/error-page";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("ref") || "work";
  const theme = url.searchParams.get("theme") as "light" | "dark" | null;
  const view = url.searchParams.get("view") as "split" | "unified" | null;
  const commit = parseCommitRef(ref);

  await Promise.all([
    queryClient.ensureQueryData(diffOptions(readViewState("diff:hide-whitespace", false), ref)),
    queryClient.ensureQueryData(repoInfoOptions(ref)),
    queryClient.prefetchQuery(statusOptions()),
    commit ? queryClient.prefetchQuery(refOptions(commit)) : null,
  ]);

  return { ref, theme, view };
}

export default function DiffRoute({ loaderData }: Route.ComponentProps) {
  const { search } = useLocation();

  useEffect(() => {
    rememberLocation("diff", search);
  }, [search]);

  return <DiffPage key={loaderData.ref} />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  return (
    <ErrorPage
      error={error}
      actions={[
        { label: "View working changes", primary: true, onClick: () => navigate("/diff") },
        { label: "Browse files", onClick: () => navigate("/tree") },
      ]}
    />
  );
}
