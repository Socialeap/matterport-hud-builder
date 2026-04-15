import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface QAEntry {
  question: string;
  answer: string;
  source_anchor_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify JWT — the anon key header is validated by Supabase Gateway,
    // but we also require a logged-in user's Bearer token.
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing authorization token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { propertySpec } = await req.json();

    if (!propertySpec || typeof propertySpec !== "string" || propertySpec.trim().length < 20) {
      return new Response(
        JSON.stringify({ error: "propertySpec is required and must be a non-trivial string" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = `You are a real estate assistant. Read the provided property specifications. Generate an exhaustive list of 100 to 150 potential questions a prospective buyer might ask about this property. For each question, provide a polite, conversational, and highly accurate answer based ONLY on the text.

Additionally, identify the specific section of the property document where this information is found. Use a kebab-case anchor ID derived from the section heading (e.g., "property-overview", "interior-features", "exterior-outdoor-living", "systems-utilities", "location-community", "recent-upgrades", "pricing", "agent-contact").

Return the result strictly as a JSON array of objects with keys: "question", "answer", and "source_anchor_id".

IMPORTANT:
- Do NOT include markdown formatting or code fences. Return ONLY the raw JSON array.
- Every answer must be grounded in the provided text. Do not invent facts.
- Cover a wide range of topics: pricing, square footage, bedrooms, bathrooms, lot size, HOA fees, HVAC, appliances, school district, parking, energy efficiency, smart home features, outdoor amenities, nearby attractions, recent renovations, etc.
- Include questions about real estate acronyms (HOA, HVAC, PUD, FHA, VA, etc.) when relevant.`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: propertySpec },
        ],
        temperature: 0.4,
        max_tokens: 16000,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI API error:", errText);
      return new Response(
        JSON.stringify({ error: "Failed to generate Q&A dictionary" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const completion = await openaiRes.json();
    const rawContent = completion.choices?.[0]?.message?.content ?? "[]";

    // Parse the JSON array — strip markdown fences if the model wraps them.
    let qaEntries: QAEntry[];
    try {
      const cleaned = rawContent
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      qaEntries = JSON.parse(cleaned);

      if (!Array.isArray(qaEntries)) {
        throw new Error("Response is not an array");
      }

      // Validate shape of each entry
      qaEntries = qaEntries.filter(
        (e) =>
          typeof e.question === "string" &&
          typeof e.answer === "string" &&
          typeof e.source_anchor_id === "string",
      );
    } catch (parseErr) {
      console.error("Failed to parse Q&A JSON:", parseErr, rawContent.slice(0, 500));
      return new Response(
        JSON.stringify({ error: "LLM returned invalid JSON for Q&A dictionary" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ entries: qaEntries }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-qa-dictionary error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
