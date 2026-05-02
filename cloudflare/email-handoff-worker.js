export default {
  async fetch(request) {
    const url = new URL(request.url);
    const to = sanitizeEmail(url.searchParams.get("to"));
    const subject = cleanHeader(url.searchParams.get("subject") || "New Inquiry");
    const body = String(url.searchParams.get("body") || "").trim().slice(0, 6000);

    if (!to) {
      return new Response("Missing or invalid 'to' parameter", {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    return new Response(null, {
      status: 302,
      headers: {
        "Location": mailto,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};

function sanitizeEmail(value) {
  const email = String(value || "")
    .trim()
    .replace(/^mailto:/i, "")
    .split("?")[0]
    .trim();

  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : "";
}

function cleanHeader(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 180);
}
