import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$slug")({
  component: () => <Outlet />,
});
