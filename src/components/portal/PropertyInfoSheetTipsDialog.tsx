import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  FileText,
  Info,
  Lightbulb,
  ListChecks,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const TEMPLATE = `Property Name
Address: 
Year built: 
Square footage: 

Overview
- One short paragraph describing the property.

Amenities
- 
- 
- 

Pricing
- Day pass: $
- Private office: $/month

Capacity
- Conference room: ___ seats
- Event space: ___ guests

Internet
- Speed: 
- Provider: 

Hours
- Monday–Friday: 
- Weekend: 

Security & Access
- 

Contact
- Name: 
- Email: 
- Phone: 
`;

interface Props {
  /** Optional custom trigger; defaults to a small info icon button. */
  trigger?: React.ReactNode;
}

/**
 * "Property Info Sheet — Tips" modal. Plain-language guidance to help
 * clients format the document they upload so the AI Chat Assistant can
 * answer visitor questions accurately. No technical jargon.
 */
export function PropertyInfoSheetTipsDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(TEMPLATE);
      toast.success("Template copied to clipboard");
    } catch {
      toast.error("Couldn't copy. Select the text and copy manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="Tips for your property info sheet"
          >
            <Info className="size-3.5" />
            Info Sheet Tips
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="size-5 text-primary" />
            Property Info Sheet — Tips
          </DialogTitle>
          <DialogDescription>
            A few simple habits make a huge difference in how well the AI
            answers questions about your property.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-3">
          <div className="space-y-5 text-sm leading-relaxed">
            {/* Why this matters */}
            <section className="rounded-md border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs text-foreground/80">
                The AI reads your document the way a careful person would. If
                the info is clearly labeled and well-organized, the AI can find
                it. If it's buried in long paragraphs, screenshots, or fancy
                layouts, it may get missed.
              </p>
            </section>

            {/* 1. Use clear sections */}
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 font-semibold">
                <ListChecks className="size-4 text-primary" />
                1. Break the document into clear sections
              </h3>
              <p className="text-muted-foreground">
                Use short, familiar headings on their own line. Examples:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Overview",
                  "Location",
                  "Amenities",
                  "Pricing",
                  "Capacity",
                  "Hours",
                  "Internet",
                  "Security",
                  "Directions",
                  "Contact",
                  "Policies",
                ].map((h) => (
                  <span
                    key={h}
                    className="rounded border bg-muted px-1.5 py-0.5 text-[11px]"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </section>

            {/* 2. One fact per line */}
            <section className="space-y-2">
              <h3 className="font-semibold">2. One fact per line</h3>
              <p className="text-muted-foreground">
                Use bullets instead of long sentences. Each bullet should be
                one fact the AI can quote back.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                  <div className="mb-1 flex items-center gap-1 font-medium text-destructive">
                    <XCircle className="size-3.5" /> Harder for the AI
                  </div>
                  <p className="text-foreground/80">
                    "We offer 12 private offices, 40 desks, a podcast room and
                    rooftop access."
                  </p>
                </div>
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
                  <div className="mb-1 flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-3.5" /> Easier for the AI
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-foreground/80">
{`- 12 private offices
- 40 hot desks
- Podcast studio
- Rooftop access`}
                  </pre>
                </div>
              </div>
            </section>

            {/* 3. Label key facts */}
            <section className="space-y-2">
              <h3 className="font-semibold">3. Label your key facts</h3>
              <p className="text-muted-foreground">
                For numbers, prices, and specs, write them as{" "}
                <strong>Label: Value</strong>. This is the single biggest thing
                you can do to improve answers.
              </p>
              <div className="rounded-md border bg-muted/40 p-2 text-xs">
                <pre className="whitespace-pre-wrap font-sans">
{`Year built: 1998
Square footage: 12,400 sq ft
Internet speed: 1 Gbps
Ceiling height: 14 ft
Day pass: $35
Private office: $850/month
Conference room capacity: 12 people
Event capacity: 150 guests
Pet policy: Dogs under 40 lbs welcome`}
                </pre>
              </div>
            </section>

            {/* 4. Things to avoid */}
            <section className="space-y-2">
              <h3 className="font-semibold">4. A few things to avoid</h3>
              <ul className="space-y-1.5 text-muted-foreground">
                <li className="flex gap-2">
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <span>
                    <strong className="text-foreground">
                      Screenshots of text or tables.
                    </strong>{" "}
                    The AI can't read pictures of words. Re-type the
                    information as bullets or labeled lines.
                  </span>
                </li>
                <li className="flex gap-2">
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <span>
                    <strong className="text-foreground">
                      Multi-column brochure layouts.
                    </strong>{" "}
                    They scramble when read out as text. A simple, single-column
                    document works best.
                  </span>
                </li>
                <li className="flex gap-2">
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <span>
                    <strong className="text-foreground">
                      Heavy headers, footers, or watermarks
                    </strong>{" "}
                    repeated on every page. They take up space the AI could use
                    for real info.
                  </span>
                </li>
                <li className="flex gap-2">
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <span>
                    <strong className="text-foreground">
                      ALL CAPS PARAGRAPHS
                    </strong>{" "}
                    and decorative dot leaders (like "Pricing ........ $50").
                  </span>
                </li>
              </ul>
            </section>

            {/* 5. File quality */}
            <section className="space-y-2">
              <h3 className="font-semibold">5. About the file itself</h3>
              <ul className="space-y-1.5 text-muted-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    Use a PDF where you can <em>select</em> the text with your
                    cursor. If the text isn't selectable, it's a scan and the
                    AI can't read it.
                  </span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    One property per file. Mixing several properties in one
                    document leads to mixed-up answers.
                  </span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    Keep it focused — under about 30 pages is ideal.
                  </span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    Use the same property name in your document as in the
                    builder.
                  </span>
                </li>
              </ul>
            </section>

            {/* 6. After upload */}
            <section className="space-y-2">
              <h3 className="font-semibold">6. After you upload</h3>
              <p className="text-muted-foreground">
                Try 5–10 questions a real visitor might ask. If something
                comes back wrong or "I don't have that detail," add a clear
                labeled line for it in your document and click{" "}
                <strong>Train Again</strong>.
              </p>
            </section>

            {/* Starter template */}
            <section className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold">
                  <FileText className="size-4 text-primary" />
                  Starter template
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  onClick={copyTemplate}
                >
                  <Copy className="size-3" />
                  Copy template
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste this into a Word doc or Google Doc, fill in the blanks,
                then export as PDF.
              </p>
              <pre className="max-h-64 overflow-auto rounded border bg-background p-2 text-[11px] leading-relaxed">
{TEMPLATE}
              </pre>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
