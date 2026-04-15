import { useState, useCallback } from "react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";

interface CheckoutOptions {
  priceId: string;
  customerEmail?: string;
  userId?: string;
  returnUrl?: string;
}

export function useStripeCheckout() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<CheckoutOptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCheckout = useCallback((opts: CheckoutOptions) => {
    setError(null);
    setOptions(opts);
    setIsOpen(true);
  }, []);

  const closeCheckout = useCallback(() => {
    setIsOpen(false);
    setOptions(null);
    setError(null);
  }, []);

  const CheckoutForm = isOpen && options
    ? () => (
        <StripeEmbeddedCheckout
          {...options}
          onError={(msg) => setError(msg)}
        />
      )
    : null;

  return { openCheckout, closeCheckout, isOpen, error, CheckoutForm };
}
