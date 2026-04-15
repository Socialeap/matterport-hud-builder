import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageSquare, Send, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRAGPipeline } from "@/hooks/use-rag-pipeline";
import type { PipelineStatus } from "@/lib/rag/types";

// ── Sample property spec (used for demo / testing) ──────────────────────

const SAMPLE_PROPERTY_SPEC = `## Property Overview
This stunning 4-bedroom, 3-bathroom modern home is located at 742 Evergreen Terrace, Springfield. Built in 2021, the property sits on a 0.35-acre lot with a total living area of 3,200 sq ft. Listed at $875,000.

## Interior Features
The home features an open-concept floor plan with 10-foot ceilings throughout the main level. The gourmet kitchen includes quartz countertops, a large center island with waterfall edge, Wolf 6-burner gas range, Sub-Zero refrigerator, and a walk-in pantry. The primary suite is on the main level with a spa-like bathroom featuring a freestanding soaking tub, dual vanities, and a frameless glass rain shower. Hardwood flooring throughout, with heated tile floors in all bathrooms.

## Exterior & Outdoor Living
The backyard features a covered patio with a built-in outdoor kitchen (gas grill, sink, mini-fridge), a heated saltwater pool (15x30 ft), and a fire pit seating area. The property is fully fenced with mature landscaping and an irrigation system. A 2-car attached garage with EV charging station is included.

## Systems & Utilities
The home is equipped with a smart home system (Lutron lighting, Nest thermostats, Ring security). HVAC is a dual-zone system with a high-efficiency heat pump. The home has a tankless water heater, 200-amp electrical panel, and a 10kW solar panel array on the roof. Estimated monthly utilities: $150-$200.

## Location & Community
Located in the award-winning Springfield School District. Walking distance to Riverside Park (0.3 mi) and the downtown shopping district (0.5 mi). 15-minute drive to Springfield Regional Airport. HOA fee: $125/month covers community pool, fitness center, and common area maintenance.

## Recent Upgrades
In 2024, the property received new interior paint throughout, upgraded smart locks on all exterior doors, a new paver driveway, and a whole-home water filtration system.`;

// ── Status label mapping ────────────────────────────────────────────────

const STATUS_LABELS: Record<PipelineStatus, string> = {
  idle: "",
  "loading-model": "Downloading AI model…",
  indexing: "Indexing property data…",
  ready: "",
  searching: "Searching property specs…",
  synthesizing: "Thinking…",
  error: "Something went wrong",
};

// ── Component ───────────────────────────────────────────────────────────

export function PropertyQnAPanel() {
  const { status, statusDetail, messages, ingest, ask, reset } =
    useRAGPipeline();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-ingest sample spec on mount
  useEffect(() => {
    if (status === "idle") {
      ingest(SAMPLE_PROPERTY_SPEC).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const isBusy =
    status === "loading-model" ||
    status === "indexing" ||
    status === "searching" ||
    status === "synthesizing";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || isBusy) return;

    setInput("");
    await ask(question);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card text-card-foreground shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Property Q&A</h3>
        {status === "ready" && messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-xs"
            onClick={reset}
          >
            Clear chat
          </Button>
        )}
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef}>
        {/* Welcome message */}
        {messages.length === 0 && status === "ready" && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground">
            <Bot className="h-10 w-10" />
            <div>
              <p className="font-medium">Ask about this property</p>
              <p className="mt-1 text-sm">
                Try: "How many bedrooms?" or "Does it have solar panels?"
              </p>
            </div>
          </div>
        )}

        {/* Chat messages */}
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isBusy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{statusDetail || STATUS_LABELS[status]}</span>
              </div>
            </div>
          )}

          {/* Error state */}
          {status === "error" && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{statusDetail || "An error occurred"}</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t px-4 py-3"
      >
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            status === "ready"
              ? "Ask a question about the property…"
              : STATUS_LABELS[status] || "Loading…"
          }
          disabled={status !== "ready"}
          className="flex-1"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || status !== "ready"}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
