import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — 3D Presentation Studio" },
      {
        name: "description",
        content:
          "Terms governing use of the 3D Presentation Studio (3DPS) platform, including license restrictions, payment terms, acceptable use, and prohibitions on copying or modifying our software.",
      },
      { property: "og:title", content: "Terms of Service — 3D Presentation Studio" },
      {
        property: "og:description",
        content:
          "License terms, payment terms, intellectual property protections, and acceptable use rules for the 3DPS platform.",
      },
      { property: "og:url", content: "https://3dps.transcendencemedia.com/terms" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Terms of Service — 3D Presentation Studio" },
      {
        name: "twitter:description",
        content:
          "License terms, payment terms, intellectual property protections, and acceptable use rules for the 3DPS platform.",
      },
    ],
    links: [{ rel: "canonical", href: "https://3dps.transcendencemedia.com/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
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
            <Link to="/privacy" className="text-white/60 transition-colors hover:text-white">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-3 text-sm text-white/50">Last updated: April 19, 2026</p>

        <div className="prose prose-invert mt-10 max-w-none space-y-8 text-white/80">
          <section>
            <h2 className="text-2xl font-semibold text-white">1. Acceptance of Terms</h2>
            <p className="mt-3">
              By accessing or using 3D Presentation Studio (&quot;3DPS&quot;, the &quot;Service&quot;),
              operated by Transcendence Media (&quot;we&quot;, &quot;us&quot;), you agree to these
              Terms of Service. If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">2. Service Description</h2>
            <p className="mt-3">
              3DPS is a white-label studio that lets managed service providers (&quot;MSPs&quot;)
              build, brand, and distribute interactive 3D property tour presentations. The Service
              includes a builder UI, a presentation generation engine that produces self-contained
              HTML deliverables, optional AI Concierge features (subject to license), and Stripe-based
              payment infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">3. Accounts &amp; Eligibility</h2>
            <p className="mt-3">
              You must be at least 18 years old and able to form a binding contract. You agree to
              provide accurate registration information, maintain the security of your credentials,
              and accept responsibility for all activity under your account.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">4. Subscriptions, Payments &amp; Refunds</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                Tier purchases (Starter, Pro, and tier upgrades) are one-time fees charged through
                Stripe at the prices listed on our pricing page.
              </li>
              <li>
                AI Concierge functionality requires an active annual upkeep license. Lapsed licenses
                disable AI features without affecting previously delivered HTML deliverables.
              </li>
              <li>
                MSPs who collect payments from their own clients through 3DPS do so via Stripe Connect
                Express; MSPs are solely responsible for tax, compliance, refunds, and disputes
                involving their clients.
              </li>
              <li>
                Because deliverables are digital and provisioned immediately, fees are generally
                non-refundable. We may, at our sole discretion, grant a refund within 7 days of
                purchase if the Service was not used or materially failed to function.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">5. Intellectual Property &amp; License Restrictions</h2>
            <p className="mt-3">
              The Service — including all source code, application files, builder UI, generation
              engine, designs, documentation, and the &quot;3D Presentation Studio&quot; and
              &quot;Transcendence Media&quot; brands — is owned by Transcendence Media and protected
              by copyright, trademark, trade-secret, and other laws.
            </p>
            <p className="mt-3">
              Subject to your compliance with these Terms and payment of applicable fees, we grant you
              a <strong>limited, non-exclusive, non-transferable, revocable license</strong> to access
              and use the Service for its intended purpose and to deliver generated HTML presentation
              files to your own clients.
            </p>
            <p className="mt-3 font-semibold text-white">You shall not:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                Access, copy, download, scrape, mirror, redistribute, or republish the Service&apos;s
                source code or application files;
              </li>
              <li>
                Reverse engineer, decompile, disassemble, or attempt to derive source code, algorithms,
                obfuscation schemes, or trade secrets from the Service or any deliverable;
              </li>
              <li>
                Modify, adapt, translate, or create derivative works of the Service or its UI;
              </li>
              <li>
                Bypass, disable, or circumvent any tier restrictions, branding gates, license checks,
                rate limits, or security mechanisms;
              </li>
              <li>
                Remove, obscure, or alter the &quot;Powered by 3D Presentation Studio&quot;
                attribution required on the Starter tier;
              </li>
              <li>
                Resell, sublicense, rent, lease, or provide the Service to third parties as a
                standalone product;
              </li>
              <li>
                Use the Service to build a competing product or to train machine-learning models on
                its outputs;
              </li>
              <li>
                Use any automated means to access the Service except as expressly permitted by us in
                writing.
              </li>
            </ul>
            <p className="mt-3">
              You retain ownership of brand assets, property data, documents, and media you upload
              (&quot;Your Content&quot;). You grant us a worldwide, royalty-free license to host,
              process, transmit, and display Your Content solely as necessary to operate the Service
              for you.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">6. Acceptable Use</h2>
            <p className="mt-3">You agree not to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>Upload content that is illegal, infringing, defamatory, or harmful;</li>
              <li>Misrepresent property facts, ownership, or pricing in presentations;</li>
              <li>Upload malware, spam, or content designed to harvest user data without consent;</li>
              <li>Abuse the lead-capture feature to send unsolicited communications;</li>
              <li>Interfere with the Service&apos;s operation or other users.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">7. Third-Party Content</h2>
            <p className="mt-3">
              Presentations embed third-party content such as Matterport tours, video providers, and
              external links. We do not control, endorse, or assume responsibility for third-party
              content, services, or their terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">8. AI Features Disclaimer</h2>
            <p className="mt-3">
              AI Concierge responses are generated by third-party language models based on documents
              you supply. Output may be incomplete, inaccurate, or out of date and is not legal,
              financial, or real-estate advice. You are responsible for reviewing AI-generated
              content before relying on it.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">9. Termination</h2>
            <p className="mt-3">
              We may suspend or terminate your access at any time for breach of these Terms, abuse,
              non-payment, or to comply with law. You may stop using the Service at any time. HTML
              deliverables already generated and delivered to you remain functional after termination,
              subject to the license restrictions above. AI Concierge features cease upon license
              lapse or termination.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">10. Disclaimers &amp; Limitation of Liability</h2>
            <p className="mt-3">
              The Service is provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; without warranty
              of any kind, express or implied, including merchantability, fitness for a particular
              purpose, and non-infringement. To the maximum extent permitted by law, our aggregate
              liability arising out of or relating to the Service shall not exceed the amount you paid
              us in the 12 months preceding the claim. We are not liable for indirect, incidental,
              special, consequential, or punitive damages.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">11. Indemnification</h2>
            <p className="mt-3">
              You agree to indemnify, defend, and hold harmless Transcendence Media and its officers,
              employees, and agents from any claims, damages, or expenses (including reasonable
              attorneys&apos; fees) arising out of Your Content, your use of the Service, your breach
              of these Terms, or disputes between you and your clients.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">12. Governing Law</h2>
            <p className="mt-3">
              These Terms are governed by the laws of the State of Florida, USA, without regard to
              conflict-of-laws rules. Exclusive venue lies in the state and federal courts located in
              Florida.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">13. Changes to Terms</h2>
            <p className="mt-3">
              We may update these Terms from time to time. Continued use of the Service after changes
              become effective constitutes acceptance. Material changes will be communicated via
              in-app notice or email.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">14. Contact</h2>
            <p className="mt-3">
              For questions about these Terms, contact us at{" "}
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
          <Link to="/privacy" className="text-white underline-offset-4 hover:underline">
            Privacy Policy
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
