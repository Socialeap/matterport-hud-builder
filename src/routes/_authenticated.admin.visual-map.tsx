import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import visualMapHtml from "../../docs/operations/visual-map/index.html?raw";

export const Route = createFileRoute("/_authenticated/admin/visual-map")({
  component: AdminVisualMap,
});

function AdminVisualMap() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Operation Visual Map
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Owner-facing orientation map. Source-of-truth remains Product
            End-States, GitHub main, Backend Activation, Current Queue, and
            STATUS.md when present.
          </p>
        </div>
        <a
          href="/admin/visual-map"
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
          Open in new tab
        </a>
      </header>
      <iframe
        title="Operation Visual Map"
        srcDoc={visualMapHtml}
        sandbox="allow-scripts"
        className="h-[calc(100vh-180px)] w-full rounded border border-border bg-background"
      />
    </div>
  );
}
