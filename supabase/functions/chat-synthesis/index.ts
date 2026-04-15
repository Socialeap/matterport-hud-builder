import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SearchResult {
  id: string;
  section: string;
  content: string;
  score: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  query: string;
  context: SearchResult[];
  history: ChatMessage[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, context, history } = (await req.json()) as RequestBody;

    if (!query || !context || !Array.isArray(context)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: query, context" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Build the context string from retrieved chunks
    const contextStr = context
      .map(
        (chunk, i) =>
          `[Source ${i + 1} — ${chunk.section}]\n${chunk.content}`,
      )
      .join("\n\n---\n\n");

    // Build conversation messages
    const messages = [
      {
        role: "system" as const,
        content: `You are a knowledgeable real estate assistant for a property presentation studio. Answer the user's query using ONLY the provided property specifications context below. Be concise, helpful, and professional.

If the answer is not contained in the provided context, politely state that you do not have that specific information in the property specifications.

Do not invent facts. Do not reference information outside the provided context.

--- PROPERTY SPECIFICATIONS CONTEXT ---
${contextStr}
--- END CONTEXT ---`,
      },
      // Include last 3 messages of chat history for conversational continuity
      ...(history || []).slice(-3).map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      {
        role: "user" as const,
        content: query,
      },
    ];

    // Call OpenAI Chat Completions API
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.3,
          max_tokens: 512,
        }),
      },
    );

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI API error:", errText);
      return new Response(
        JSON.stringify({ error: "Failed to generate answer" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const completion = await openaiRes.json();
    const answer =
      completion.choices?.[0]?.message?.content ??
      "I was unable to generate a response.";

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("chat-synthesis error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
