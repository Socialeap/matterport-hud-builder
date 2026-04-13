import { createFileRoute } from "@tanstack/react-router";
import { SignupForm } from "@/components/auth/SignupForm";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || "",
    email: (search.email as string) || "",
  }),
  component: SignupPage,
});

function SignupPage() {
  const { token, email } = Route.useSearch();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignupForm inviteToken={token || undefined} inviteEmail={email || undefined} />
    </div>
  );
}
