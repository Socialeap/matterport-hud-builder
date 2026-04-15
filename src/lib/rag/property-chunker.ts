/**
 * Chunks a property specification document into logical segments suitable
 * for embedding and retrieval.
 *
 * Supported input formats:
 *  - Markdown: split on ## / ### headings
 *  - JSON: split on top-level keys (each key becomes a section)
 *  - Plain text: split on double newlines with a max-token guard
 */

import type { PropertyChunk } from "./types";

const MAX_CHUNK_CHARS = 1000;

/** Deterministic chunk id from section name + index. */
function chunkId(section: string, index: number): string {
  const slug = section
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug}-${index}`;
}

// ── Markdown chunker ────────────────────────────────────────────────────

function chunkMarkdown(md: string): PropertyChunk[] {
  const chunks: PropertyChunk[] = [];
  // Split on lines that start with ## or ###
  const sections = md.split(/^(?=#{2,3}\s)/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // Extract the heading (first line) as the section name.
    const headingMatch = trimmed.match(/^#{2,3}\s+(.+)/);
    const sectionName = headingMatch ? headingMatch[1].trim() : "Overview";
    const body = headingMatch
      ? trimmed.slice(headingMatch[0].length).trim()
      : trimmed;

    if (!body) continue;

    // If the section body is short enough, keep it as one chunk.
    if (body.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        id: chunkId(sectionName, chunks.length),
        section: sectionName,
        content: body,
      });
    } else {
      // Split on paragraph boundaries.
      const paragraphs = body.split(/\n{2,}/);
      let buffer = "";

      for (const para of paragraphs) {
        if (buffer.length + para.length > MAX_CHUNK_CHARS && buffer) {
          chunks.push({
            id: chunkId(sectionName, chunks.length),
            section: sectionName,
            content: buffer.trim(),
          });
          buffer = "";
        }
        buffer += (buffer ? "\n\n" : "") + para;
      }
      if (buffer.trim()) {
        chunks.push({
          id: chunkId(sectionName, chunks.length),
          section: sectionName,
          content: buffer.trim(),
        });
      }
    }
  }

  return chunks;
}

// ── JSON chunker ────────────────────────────────────────────────────────

function chunkJSON(obj: Record<string, unknown>): PropertyChunk[] {
  const chunks: PropertyChunk[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const sectionName = key
      .replace(/([A-Z])/g, " $1")
      .replace(/[_-]/g, " ")
      .trim();
    const content =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);

    if (content.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        id: chunkId(sectionName, chunks.length),
        section: sectionName,
        content,
      });
    } else {
      // For large JSON values, split on a line-count basis.
      const lines = content.split("\n");
      let buffer = "";

      for (const line of lines) {
        if (buffer.length + line.length > MAX_CHUNK_CHARS && buffer) {
          chunks.push({
            id: chunkId(sectionName, chunks.length),
            section: sectionName,
            content: buffer.trim(),
          });
          buffer = "";
        }
        buffer += (buffer ? "\n" : "") + line;
      }
      if (buffer.trim()) {
        chunks.push({
          id: chunkId(sectionName, chunks.length),
          section: sectionName,
          content: buffer.trim(),
        });
      }
    }
  }

  return chunks;
}

// ── Plain text chunker ──────────────────────────────────────────────────

function chunkPlainText(text: string): PropertyChunk[] {
  const chunks: PropertyChunk[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let buffer = "";
  let idx = 0;

  for (const para of paragraphs) {
    if (buffer.length + para.length > MAX_CHUNK_CHARS && buffer) {
      chunks.push({
        id: chunkId("section", idx++),
        section: "General",
        content: buffer.trim(),
      });
      buffer = "";
    }
    buffer += (buffer ? "\n\n" : "") + para;
  }

  if (buffer.trim()) {
    chunks.push({
      id: chunkId("section", idx),
      section: "General",
      content: buffer.trim(),
    });
  }

  return chunks;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Auto-detect the format and chunk accordingly.
 *
 * @param input - raw property specification (markdown string, JSON string, or
 *   a plain JS object)
 */
export function chunkPropertySpec(
  input: string | Record<string, unknown>
): PropertyChunk[] {
  // JS object → JSON chunker
  if (typeof input === "object") {
    return chunkJSON(input);
  }

  // Try parsing as JSON string
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return chunkJSON(parsed as Record<string, unknown>);
    }
  } catch {
    // Not JSON – continue
  }

  // Markdown (contains headings)
  if (/^#{2,3}\s/m.test(input)) {
    return chunkMarkdown(input);
  }

  // Fallback: plain text
  return chunkPlainText(input);
}
