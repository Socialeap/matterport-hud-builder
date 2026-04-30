import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

interface MspAccessState {
  loading: boolean;
  /** True when the MSP has a paid (or admin-granted) entitlement, OR is a client. */
  hasPaid: boolean;
  /** True if the current viewer is a client (not an MSP). */
  isClient: boolean;
  /** Refetch — call after a purchase/grant change. */
  refetch: () => void;
}

const MspAccessContext = createContext<MspAccessState | null>(null);

export function MspAccessProvider({ children }: { children: ReactNode }) {
  const { user, roles } = useAuth();
  const isClient = roles.includes("client") && !roles.includes("provider") && !roles.includes("admin");
  const [loading, setLoading] = useState(true);
  const [hasPaid, setHasPaid] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setHasPaid(false);
      return;
    }
    if (isClient) {
      // Clients inherit access via their provider — never gated here.
      setHasPaid(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Use the same SECURITY DEFINER RPC the public Studio route uses, so
      // the dashboard's "hasPaid" flag never disagrees with the public
      // paywall (which would let an unpaid MSP think they have a live URL).
      const { data, error } = await supabase.rpc("provider_has_paid_access", {
        _provider_id: user.id,
      });

      if (cancelled) return;

      setHasPaid(error ? false : data === true);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isClient, tick]);

  return (
    <MspAccessContext.Provider
      value={{
        loading,
        hasPaid,
        isClient,
        refetch: () => setTick((n) => n + 1),
      }}
    >
      {children}
    </MspAccessContext.Provider>
  );
}

export function useMspAccess(): MspAccessState {
  const ctx = useContext(MspAccessContext);
  if (!ctx) {
    // Safe defaults for any consumer rendered outside the provider (e.g. SSR or stray usage).
    return {
      loading: true,
      hasPaid: false,
      isClient: false,
      refetch: () => {},
    };
  }
  return ctx;
}
