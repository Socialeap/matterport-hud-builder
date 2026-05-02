const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Email Contact</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f8fb;
      color: #101828;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    main {
      width: min(560px, 100%);
      background: #fff;
      border: 1px solid #d9e0ea;
      border-radius: 12px;
      box-shadow: 0 18px 50px rgba(16, 24, 40, 0.12);
      padding: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 22px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 16px;
      color: #5b667a;
      line-height: 1.5;
    }
    .details {
      display: grid;
      gap: 10px;
      margin: 18px 0;
      padding: 14px;
      border-radius: 8px;
      background: #f3f6fa;
      border: 1px solid #e2e8f0;
      font-size: 14px;
    }
    .label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: #667085;
      margin-bottom: 3px;
    }
    .value {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .hint {
      margin: 2px 0 18px;
      color: #667085;
      font-size: 13px;
      line-height: 1.45;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 18px;
    }
    a, button {
      appearance: none;
      border: 0;
      border-radius: 8px;
      padding: 12px;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
    }
    .service {
      background: #edf2f7;
      color: #172033;
    }
    .service:hover {
      background: #e2e8f0;
    }
    .copy {
      grid-column: 1 / -1;
      background: #fff;
      color: #344054;
      border: 1px solid #d0d5dd;
    }
    .copy:hover {
      background: #f8fafc;
    }
    .status {
      min-height: 20px;
      margin-top: 14px;
      font-size: 13px;
      color: #047857;
    }
    .error {
      color: #b42318;
      background: #fff1f0;
      border: 1px solid #fecdca;
      border-radius: 8px;
      padding: 12px;
    }
    @media (max-width: 460px) {
      body { padding: 12px; }
      main { padding: 18px; }
      .actions { grid-template-columns: 1fr; }
      .copy { grid-column: auto; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Email Contact</h1>
    <p>Choose an email service to open a draft with the message below.</p>
    <p class="hint">Use Copy email details if you prefer another email app, or if your service asks you to paste the message manually.</p>

    <div id="error" class="error" hidden></div>

    <section class="details" id="details" hidden>
      <div>
        <div class="label">To</div>
        <div class="value" id="toValue"></div>
      </div>
      <div>
        <div class="label">Subject</div>
        <div class="value" id="subjectValue"></div>
      </div>
      <div>
        <div class="label">Message</div>
        <div class="value" id="bodyValue"></div>
      </div>
    </section>

    <div class="actions" id="actions" hidden>
      <a id="gmail" class="service" href="#">Gmail</a>
      <a id="outlook" class="service" href="#">Outlook</a>
      <a id="yahoo" class="service" href="#">Yahoo</a>
      <a id="icloud" class="service" href="#">iCloud Mail</a>
      <button id="copy" class="copy" type="button">Copy email details</button>
    </div>

    <div id="status" class="status" aria-live="polite"></div>
  </main>

  <script>
    (function () {
      var params = readPayload();
      var to = sanitizeEmail(params.get("to"));
      var subject = cleanHeader(params.get("subject") || "New Inquiry");
      var body = String(params.get("body") || "").trim();
      var details = "To: " + to + "\\nSubject: " + subject + "\\n\\n" + body;

      var errorEl = document.getElementById("error");
      var detailsEl = document.getElementById("details");
      var actionsEl = document.getElementById("actions");
      var statusEl = document.getElementById("status");

      if (!to) {
        errorEl.hidden = false;
        errorEl.textContent = "Missing or invalid recipient email.";
        return;
      }

      document.getElementById("toValue").textContent = to;
      document.getElementById("subjectValue").textContent = subject;
      document.getElementById("bodyValue").textContent = body || "(No message provided)";
      detailsEl.hidden = false;
      actionsEl.hidden = false;

      document.getElementById("gmail").href =
        "https://mail.google.com/mail/?view=cm&fs=1" +
        "&to=" + encodeURIComponent(to) +
        "&su=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);

      document.getElementById("outlook").href =
        "https://outlook.live.com/mail/0/deeplink/compose" +
        "?to=" + encodeURIComponent(to) +
        "&subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);

      document.getElementById("yahoo").href =
        "https://compose.mail.yahoo.com/" +
        "?to=" + encodeURIComponent(to) +
        "&subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);

      var icloudEl = document.getElementById("icloud");
      icloudEl.href = "https://www.icloud.com/mail/";
      icloudEl.addEventListener("click", function (event) {
        event.preventDefault();
        var href = icloudEl.href;
        Promise.resolve(copyText(details, "Copied details for iCloud Mail."))
          .then(function () {
            window.location.href = href;
          });
      });

      document.getElementById("copy").addEventListener("click", function () {
        copyText(details, "Copied email details.");
      });

      function readPayload() {
        var hash = window.location.hash ? window.location.hash.slice(1) : "";
        if (hash.indexOf("?") === 0) hash = hash.slice(1);
        if (hash) return new URLSearchParams(hash);
        return new URLSearchParams(window.location.search);
      }

      function sanitizeEmail(value) {
        var email = String(value || "")
          .trim()
          .replace(/^mailto:/i, "")
          .split("?")[0]
          .trim();

        return /^[^\\s@<>"]+@[^\\s@<>"]+\\.[^\\s@<>"]+$/.test(email) ? email : "";
      }

      function cleanHeader(value) {
        return String(value || "")
          .replace(/[\\r\\n]+/g, " ")
          .trim()
          .slice(0, 180);
      }

      async function copyText(text, message) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            var ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
          statusEl.textContent = message || "Copied.";
        } catch (_err) {
          statusEl.textContent = "Could not copy. Select the details above manually.";
        }
      }
    })();
  </script>
</body>
</html>`;

const HEADERS = {
  "Content-Type": "text/html; charset=UTF-8",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none';",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export default {
  async fetch() {
    return new Response(HTML, {
      status: 200,
      headers: HEADERS,
    });
  },
};
