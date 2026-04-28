import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Eye, EyeOff } from "lucide-react";
import type { DraftAccessState } from "@/lib/portal/draft-storage";

interface PrivacyAccessSectionProps {
  access: DraftAccessState;
  onChange: (next: DraftAccessState) => void;
  /** Render only the inner form (no Card/Header) — used inside Accordion. */
  headless?: boolean;
}

export const ACCESS_PASSWORD_MIN_LEN = 4;
export const ACCESS_HINT_MAX_LEN = 120;

export function isAccessArmed(access: DraftAccessState | undefined): boolean {
  if (!access?.passwordProtected) return false;
  return (access.password?.length ?? 0) >= ACCESS_PASSWORD_MIN_LEN;
}

export function PrivacyAccessSection({ access, onChange, headless }: PrivacyAccessSectionProps) {
  const [showPassword, setShowPassword] = useState(false);

  const passwordTooShort =
    access.passwordProtected &&
    access.password.length > 0 &&
    access.password.length < ACCESS_PASSWORD_MIN_LEN;

  const body = (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-3">
        <div className="space-y-1">
          <Label htmlFor="privacy-access-toggle" className="text-sm font-medium">
            Require password to view
          </Label>
          <p className="text-xs text-muted-foreground">
            Off by default. When enabled, visitors must enter the password
            below before the property tour, agent contact, or documents are
            decrypted in their browser.
          </p>
        </div>
        <Switch
          id="privacy-access-toggle"
          checked={access.passwordProtected}
          onCheckedChange={(checked) =>
            onChange({ ...access, passwordProtected: checked })
          }
        />
      </div>

      {access.passwordProtected && (
        <>
          <div className="space-y-2">
            <Label htmlFor="privacy-access-password">
              Password <span className="text-xs text-muted-foreground font-normal">(min {ACCESS_PASSWORD_MIN_LEN} characters)</span>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="privacy-access-password"
                type={showPassword ? "text" : "password"}
                value={access.password}
                autoComplete="off"
                spellCheck={false}
                placeholder="Set a password to enable protection"
                onChange={(e) => onChange({ ...access, password: e.target.value })}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            {passwordTooShort && (
              <p className="text-xs text-amber-600">
                Password must be at least {ACCESS_PASSWORD_MIN_LEN} characters before protection turns on.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="privacy-access-hint">
              Visitor hint <span className="text-xs text-muted-foreground font-normal">(optional, ≤{ACCESS_HINT_MAX_LEN} chars)</span>
            </Label>
            <Input
              id="privacy-access-hint"
              type="text"
              value={access.passwordHint}
              maxLength={ACCESS_HINT_MAX_LEN}
              placeholder='e.g. "the street name, lower-case"'
              onChange={(e) =>
                onChange({ ...access, passwordHint: e.target.value.slice(0, ACCESS_HINT_MAX_LEN) })
              }
            />
            <p className="text-xs text-muted-foreground">
              Shown on the gate next to the password field. Plaintext — don't
              put anything you wouldn't want visitors to read.
            </p>
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900/90 dark:text-amber-200/90 space-y-1">
            <p className="font-medium">Where the password is stored</p>
            <p>
              The password is saved with this draft in your browser so you
              don't have to re-enter it. Anyone with access to this browser
              can read it. We never send it to our servers and never persist
              it in your saved presentations.
            </p>
            <p>
              If you forget the password, just download the presentation
              again with a new one — old downloads will keep working with
              their original password.
            </p>
          </div>
        </>
      )}
    </div>
  );

  if (headless) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-5 text-primary" />
          Privacy & Access
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
