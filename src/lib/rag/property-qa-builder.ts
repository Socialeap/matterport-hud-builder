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
 * Every emitted entry is tagged with a canonical `field` key so the
 * runtime's `curatedFilter` (in `ask-runtime-logic.mjs`) can gate hits
 * through the same `FIELD_COMPAT` allow/exclude matrix that protects
 * extraction-derived QAs. Without `field`, the runtime falls back to
 * the empty-key path in `curatedFilter`, which leaks agent/contact
 * answers into size, cost, and age queries.
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
        source_anchor_id: "tour-property-count",
        field: "tour_property_count",
      },
      {
        question: "What properties are available?",
        answer: `This tour includes: ${names}.`,
        source_anchor_id: "tour-property-list",
        field: "tour_property_list",
      },
      {
        question: "What's in this tour?",
        answer: `This tour includes: ${names}.`,
        source_anchor_id: "tour-property-list",
        field: "tour_property_list",
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
          source_anchor_id: "property-name",
          field: "property_name",
        },
        {
          question: `Tell me about ${model.name}.`,
          answer: nonEmpty(model.location)
            ? `${model.name} is located at ${model.location}.`
            : `${model.name} is one of the properties in this tour.`,
          source_anchor_id: "property-summary",
          field: "property_summary",
        },
      );
    }
    if (nonEmpty(model.location)) {
      entries.push(
        {
          question: `Where is ${label} located?`,
          answer: `${label} is located at ${model.location}.`,
          source_anchor_id: "property-address",
          field: "property_address",
        },
        {
          question: `What's the address of ${label}?`,
          answer: `${label} is at ${model.location}.`,
          source_anchor_id: "property-address",
          field: "property_address",
        },
        {
          question: `Where is ${label}?`,
          answer: `${label} is at ${model.location}.`,
          source_anchor_id: "property-address",
          field: "property_address",
        },
      );
      // Plain-keyword phrasings so single-property tours answer
      // "where is it" / "what's the address" without property name.
      if (models.length === 1) {
        entries.push(
          {
            question: "Where is it?",
            answer: `It's located at ${model.location}.`,
            source_anchor_id: "property-address",
            field: "property_address",
          },
          {
            question: "What's the address?",
            answer: `The address is ${model.location}.`,
            source_anchor_id: "property-address",
            field: "property_address",
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
        source_anchor_id: "agent-name",
        field: "agent_name",
      },
      {
        question: "Who's representing this listing?",
        answer: `${agent.name} is representing this listing.`,
        source_anchor_id: "agent-name",
        field: "agent_name",
      },
      {
        question: "Who do I talk to about this?",
        answer: `Reach out to ${titled}.`,
        source_anchor_id: "agent-name",
        field: "agent_name",
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
      source_anchor_id: "agent-contact",
      field: "agent_contact",
    });
  }

  if (nonEmpty(agent.email)) {
    entries.push(
      {
        question: "What's the agent's email?",
        answer: `Email the agent at ${agent.email}.`,
        source_anchor_id: "agent-email",
        field: "agent_email",
      },
      {
        question: "How do I email the agent?",
        answer: `Email the agent at ${agent.email}.`,
        source_anchor_id: "agent-email",
        field: "agent_email",
      },
    );
  }

  if (nonEmpty(agent.phone)) {
    entries.push(
      {
        question: "What's the agent's phone number?",
        answer: `Call the agent at ${agent.phone}.`,
        source_anchor_id: "agent-phone",
        field: "agent_phone",
      },
      {
        question: "How do I call the agent?",
        answer: `Call the agent at ${agent.phone}.`,
        source_anchor_id: "agent-phone",
        field: "agent_phone",
      },
    );
  }

  if (nonEmpty(agent.welcomeNote)) {
    entries.push(
      {
        question: "What's the message from the agent?",
        answer: agent.welcomeNote,
        source_anchor_id: "agent-welcome-note",
        field: "agent_welcome_note",
      },
      {
        question: "Any note from the agent?",
        answer: agent.welcomeNote,
        source_anchor_id: "agent-welcome-note",
        field: "agent_welcome_note",
      },
    );
  }

  if (nonEmpty(agent.website)) {
    entries.push({
      question: "Does the agent have a website?",
      answer: `The agent's website is ${agent.website}.`,
      source_anchor_id: "agent-website",
      field: "agent_website",
    });
  }

  return entries;
}
