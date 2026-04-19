import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — 3D Presentation Studio" },
      {
        name: "description",
        content:
          "How 3D Presentation Studio (3DPS) collects, uses, and protects information from MSPs, their clients, and end viewers of branded 3D property tour presentations.",
      },
      { property: "og:title", content: "Privacy Policy — 3D Presentation Studio" },
      {
        property: "og:description",
        content:
          "How 3DPS handles account data, branding assets, payment metadata, lead capture, and third-party integrations.",
      },
      { property: "og:url", content: "https://3dps.transcendencemedia.com/privacy" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Privacy Policy — 3D Presentation Studio" },
      {
        name: "twitter:description",
        content:
          "How 3DPS handles account data, branding assets, payment metadata, lead capture, and third-party integrations.",
      },
    ],
    links: [{ rel: "canonical", href: "https://3dps.transcendencemedia.com/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0b0b14] text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0b14]/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-lg font-bold text-white">
            3D Presentation Studio
          </Link>
          <nav className="flex gap-6 text-sm">
            <Link to="/" className="text-white/60 transition-colors hover:text-white">
              Home
            </Link>
            <Link to="/terms" className="text-white/60 transition-colors hover:text-white">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm text-white/50">Last updated: April 19, 2026</p>

        <div className="prose prose-invert mt-10 max-w-none space-y-8 text-white/80">
          <section>
            <h2 className="text-2xl font-semibold text-white">1. Introduction</h2>
            <p className="mt-3">
              3D Presentation Studio (&quot;3DPS&quot;, &quot;we&quot;, &quot;us&quot;), operated by
              Transcendence Media, provides a white-label SaaS platform that lets managed service
              providers (&quot;MSPs&quot;) build, brand, and distribute interactive 3D property tour
              presentations to their clients and end viewers. This Privacy Policy explains what we
              collect, how we use it, and your choices.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">2. Information We Collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                <strong>Account information.</strong> Email, name, hashed password (or Google OAuth
                identifier), and role (admin, MSP/provider, client).
              </li>
              <li>
                <strong>Branding &amp; configuration assets.</strong> Logos, favicons, brand colors,
                domain settings, agent contact details, and presentation behavior options uploaded
                by MSPs and their clients.
              </li>
              <li>
                <strong>Property &amp; presentation data.</strong> Matterport tour URLs, property
                documents, media (images/video), AI knowledge templates, and tour configurations.
              </li>
              <li>
                <strong>Payment metadata.</strong> Stripe processes all payments. We store
                transaction identifiers, amounts, status, and Stripe Connect account references — we
                never see or store your card number.
              </li>
              <li>
                <strong>Viewer leads.</strong> When end viewers of an MSP&apos;s presentation choose
                to contact the MSP through the AI Concierge, the contact information they submit is
                forwarded to that MSP and logged for delivery auditing.
              </li>
              <li>
                <strong>Operational telemetry.</strong> IP address, user agent, request logs, and
                error traces used for security, debugging, and abuse prevention.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">3. How We Use Information</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>Operate, secure, and improve the platform and generated presentations.</li>
              <li>Process payments and route MSP payouts through Stripe Connect.</li>
              <li>Deliver transactional emails (invitations, receipts, lead alerts, password resets).</li>
              <li>Power AI Concierge responses about properties using documents the MSP has uploaded.</li>
              <li>Detect fraud, enforce our Terms of Service, and comply with legal obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">4. Third-Party Services</h2>
            <p className="mt-3">
              We rely on the following sub-processors. Your data is shared with them only as needed to
              run the service:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                <strong>Stripe</strong> — payment processing and Connect Express MSP payouts.
              </li>
              <li>
                <strong>Lovable Cloud (Supabase)</strong> — managed database, authentication, file
                storage, and serverless functions.
              </li>
              <li>
                <strong>Matterport</strong> — embedded 3D tour iframes. Matterport may set its own
                cookies; their privacy policy applies to that content.
              </li>
              <li>
                <strong>Resend</strong> — transactional email delivery.
              </li>
              <li>
                <strong>Lovable AI Gateway (Google Gemini models)</strong> — generates AI Concierge
                responses. Prompts and document context are sent for inference.
              </li>
              <li>
                <strong>Google OAuth</strong> — optional sign-in.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">5. Cookies &amp; Local Storage</h2>
            <p className="mt-3">
              We use first-party cookies and browser local storage for authentication sessions, theme
              preferences, and remembering UI state (e.g. dismissed banners). Embedded third-party
              tours and media may set their own cookies governed by those providers.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">6. Data Retention</h2>
            <p className="mt-3">
              Account, branding, and presentation data are retained for the life of your account and
              for a reasonable period afterward to support backups and dispute resolution. Lead
              records and email logs are retained for operational and legal compliance. You may request
              deletion at any time (see Section 8).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">7. Generated Presentation Files</h2>
            <p className="mt-3">
              The downloadable HTML presentation files 3DPS produces are designed to be self-contained
              and host-anywhere. Once delivered, those files do not transmit data back to 3DPS. Their
              behavior, hosting, and analytics integrations are the responsibility of the MSP or end
              host.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">8. Your Rights</h2>
            <p className="mt-3">
              Subject to applicable law (including GDPR and CCPA where relevant), you may request
              access to, correction of, export of, or deletion of your personal information. Contact us
              at the address below and we will respond within a reasonable timeframe.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">9. Children</h2>
            <p className="mt-3">
              3DPS is not intended for children under 13, and we do not knowingly collect their data.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">10. International Transfers</h2>
            <p className="mt-3">
              Our infrastructure and sub-processors may store and process data in the United States
              and other jurisdictions. By using 3DPS, you consent to such transfers.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">11. Security</h2>
            <p className="mt-3">
              We use industry-standard safeguards including TLS in transit, encryption at rest via our
              managed database provider, role-based access control, and row-level security on tenant
              data. No system is perfectly secure — please use a strong, unique password.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">12. Changes</h2>
            <p className="mt-3">
              We may update this policy. Material changes will be communicated via in-app notice or
              email. The &quot;Last updated&quot; date above reflects the current version.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">13. Contact</h2>
            <p className="mt-3">
              Questions, requests, or complaints? Contact us at{" "}
              <a
                href="mailto:legal@transcendencemedia.com"
                className="text-primary underline-offset-4 hover:underline"
              >
                legal@transcendencemedia.com
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-16 border-t border-white/10 pt-6 text-sm text-white/50">
          See also our{" "}
          <Link to="/terms" className="text-white underline-offset-4 hover:underline">
            Terms of Service
          </Link>
          .
        </div>
      </main>

      <footer className="border-t border-white/10 px-4 py-8 text-center text-xs text-white/40">
        © {new Date().getFullYear()} Transcendence Media. All rights reserved.
      </footer>
    </div>
  );
}
