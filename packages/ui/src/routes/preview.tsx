import { useQuery } from "@tanstack/react-query";
import { useRouteError, useNavigate } from "react-router";
import type { Route } from "./+types/preview";
import { queryClient } from "../lib/query-client";
import { headFileContentOptions } from "../queries/file";
import { MarkdownPreview } from "../components/tree/markdown-preview";
import { ErrorPage } from "../components/error-page";
import { Spinner } from "../components/icons/spinner";
import { Badge } from "../components/ui/badge";
import { useTheme } from "../hooks/use-theme";

const WORKING_TREE_LABELS: Record<string, string> = {
  work: "working tree",
  ".": "working tree",
  unstaged: "working tree",
  staged: "index",
};

function refLabel(ref: string): string {
  return WORKING_TREE_LABELS[ref] || ref;
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "";
  const ref = url.searchParams.get("ref") || "work";
  const theme = url.searchParams.get("theme") as "light" | "dark" | null;

  if (path) {
    await queryClient.ensureQueryData(headFileContentOptions(path, ref));
  }

  return { path, ref, theme };
}

export default function PreviewRoute({ loaderData }: Route.ComponentProps) {
  const { path, ref, theme: initialTheme } = loaderData;
  useTheme(initialTheme);

  const { data: content, isLoading } = useQuery({
    ...headFileContentOptions(path, ref),
    enabled: Boolean(path),
  });

  return (
    <div className="min-h-screen bg-bg">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-secondary text-xs sticky top-0 z-10">
        <span className="font-mono truncate text-text">{path}</span>
        <Badge className="bg-bg-tertiary text-text-muted">{refLabel(ref)}</Badge>
      </div>
      <div className="p-4">
        {!path ? (
          <div className="flex items-center justify-center h-32 text-xs text-text-muted">
            No file specified
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="w-5 h-5" />
          </div>
        ) : (
          <MarkdownPreview content={content || []} filePath={path} />
        )}
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  return (
    <ErrorPage
      error={error}
      actions={[
        { label: "View diff", primary: true, onClick: () => navigate("/diff") },
        { label: "Browse files", onClick: () => navigate("/tree") },
      ]}
    />
  );
}
