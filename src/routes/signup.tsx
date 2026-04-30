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
  // If a token is present in the URL, this is the invited-client flow.
  // Otherwise it's the public MSP signup.
  const mode = token ? "invite" : "open";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignupForm
        mode={mode}
        inviteToken={token || undefined}
        inviteEmail={email || undefined}
      />
    </div>
  );
}
