/**
 * Rule-based property-level Q&A pair generator.
 *
 * Phase 5c replaces the `generate-qa-dictionary` edge function (which
 * called OpenAI gpt-4o-mini) with deterministic, schema-known templating
 * that runs entirely client-side. These pairs feed the delivered tour's
 * "Ask AI" panel (window.__QA_DATABASE__), which does semantic search
 * over the pre-embedded questions at view time.
 *
 * Coverage is narrower than GPT's freeform output (~15–30 pairs vs.
 * ~100–150), but the doc-QA panel added in Phase 5 already handles the
 * long-tail of content-grounded questions via chunk embeddings +
 * canonical-field routing. This surface only needs to cover the
 * top-of-funnel metadata questions a viewer is likely to ask:
 * property name, address, agent contact, agent note.
 *
 * Anchor IDs are left empty; the tour runtime renders a source chip
 * only when `source_anchor_id` matches a real DOM id, so empty strings
 * cleanly skip that affordance (same fallback path as misaligned IDs
 * under the old OpenAI pipeline).
 */

import type { PropertyModel, AgentContact } from "@/components/portal/types";
import type { QAEntry } from "./types";

function nonEmpty(s: string | undefined | null): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function labelFor(model: PropertyModel, index: number): string {
  return nonEmpty(model.name) ? model.name : `property ${index + 1}`;
}

/**
 * Build a Q&A dictionary from structured builder state. Pure function —
 * no network, no LLM, no side effects. Returns an empty array when
 * there's nothing meaningful to answer.
 */
export function buildPropertyQAEntries(
  models: PropertyModel[],
  agent: AgentContact,
): QAEntry[] {
  const entries: QAEntry[] = [];

  // ── Tour-level (multi-property tours only) ──────────────────────
  if (models.length > 1) {
    const names = models
      .map((m, i) => (nonEmpty(m.name) ? m.name : `property ${i + 1}`))
      .join(", ");
    entries.push(
      {
        question: "How many properties are in this tour?",
        answer: `There are ${models.length} properties in this tour.`,
        source_anchor_id: "",
      },
      {
        question: "What properties are available?",
        answer: `This tour includes: ${names}.`,
        source_anchor_id: "",
      },
      {
        question: "What's in this tour?",
        answer: `This tour includes: ${names}.`,
        source_anchor_id: "",
      },
    );
  }

  // ── Per-property ────────────────────────────────────────────────
  models.forEach((model, i) => {
    const label = labelFor(model, i);
    if (nonEmpty(model.name)) {
      entries.push(
        {
          question: `What's the name of property ${i + 1}?`,
          answer: `Property ${i + 1} is ${model.name}.`,
          source_anchor_id: "",
        },
        {
          question: `Tell me about ${model.name}.`,
          answer: nonEmpty(model.location)
            ? `${model.name} is located at ${model.location}.`
            : `${model.name} is one of the properties in this tour.`,
          source_anchor_id: "",
        },
      );
    }
    if (nonEmpty(model.location)) {
      entries.push(
        {
          question: `Where is ${label} located?`,
          answer: `${label} is located at ${model.location}.`,
          source_anchor_id: "",
        },
        {
          question: `What's the address of ${label}?`,
          answer: `${label} is at ${model.location}.`,
          source_anchor_id: "",
        },
        {
          question: `Where is ${label}?`,
          answer: `${label} is at ${model.location}.`,
          source_anchor_id: "",
        },
      );
      // Plain-keyword phrasings so single-property tours answer
      // "where is it" / "what's the address" without property name.
      if (models.length === 1) {
        entries.push(
          {
            question: "Where is it?",
            answer: `It's located at ${model.location}.`,
            source_anchor_id: "",
          },
          {
            question: "What's the address?",
            answer: `The address is ${model.location}.`,
            source_anchor_id: "",
          },
        );
      }
    }
  });

  // ── Agent ───────────────────────────────────────────────────────
  if (nonEmpty(agent.name)) {
    const titled = nonEmpty(agent.titleRole)
      ? `${agent.name}, ${agent.titleRole}`
      : agent.name;
    entries.push(
      {
        question: "Who's the agent?",
        answer: `The agent is ${titled}.`,
        source_anchor_id: "",
      },
      {
        question: "Who's representing this listing?",
        answer: `${agent.name} is representing this listing.`,
        source_anchor_id: "",
      },
      {
        question: "Who do I talk to about this?",
        answer: `Reach out to ${titled}.`,
        source_anchor_id: "",
      },
    );
  }

  const contactBits: string[] = [];
  if (nonEmpty(agent.email)) contactBits.push(`email ${agent.email}`);
  if (nonEmpty(agent.phone)) contactBits.push(`phone ${agent.phone}`);
  if (contactBits.length > 0) {
    entries.push({
      question: "How do I contact the agent?",
      answer: `You can reach the agent by ${contactBits.join(" or ")}.`,
      source_anchor_id: "",
    });
  }

  if (nonEmpty(agent.email)) {
    entries.push(
      {
        question: "What's the agent's email?",
        answer: `Email the agent at ${agent.email}.`,
        source_anchor_id: "",
      },
      {
        question: "How do I email the agent?",
        answer: `Email the agent at ${agent.email}.`,
        source_anchor_id: "",
      },
    );
  }

  if (nonEmpty(agent.phone)) {
    entries.push(
      {
        question: "What's the agent's phone number?",
        answer: `Call the agent at ${agent.phone}.`,
        source_anchor_id: "",
      },
      {
        question: "How do I call the agent?",
        answer: `Call the agent at ${agent.phone}.`,
        source_anchor_id: "",
      },
    );
  }

  if (nonEmpty(agent.welcomeNote)) {
    entries.push(
      {
        question: "What's the message from the agent?",
        answer: agent.welcomeNote,
        source_anchor_id: "",
      },
      {
        question: "Any note from the agent?",
        answer: agent.welcomeNote,
        source_anchor_id: "",
      },
    );
  }

  if (nonEmpty(agent.website)) {
    entries.push({
      question: "Does the agent have a website?",
      answer: `The agent's website is ${agent.website}.`,
      source_anchor_id: "",
    });
  }

  return entries;
}
