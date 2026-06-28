/**
 * Wraps drip-email body content (authored in the admin Tiptap editor and stored
 * as an HTML fragment) in the branded Vidacure email shell, and substitutes
 * personalization tokens. This keeps the branding consistent across every drip
 * email — admins only author the content, never the layout.
 *
 * Supported tokens in the content: {given_name}
 */

type RenderOptions = {
  givenName?: string;
};

/** Replace personalization tokens with the patient's values (HTML-escaped). */
function applyTokens(content: string, opts: RenderOptions): string {
  const givenName = escapeHtml(opts.givenName || "").trim();
  return content.replace(/\{given_name\}/g, givenName || "där");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Produce the full HTML email from a content fragment.
 * `content` is trusted admin-authored HTML (from the Tiptap editor).
 */
export function renderVidacureEmail(content: string, opts: RenderOptions = {}): string {
  const body = applyTokens(content, opts);

  return `
<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vidacure</title>
  <style>
    .vc-content h1 { margin:0 0 12px; font-size:22px; color:#005044; }
    .vc-content h2 { margin:0 0 10px; font-size:19px; color:#005044; }
    .vc-content h3 { margin:0 0 8px; font-size:16px; color:#005044; }
    .vc-content p { margin:0 0 14px; font-size:14px; color:#333; line-height:1.6; }
    .vc-content a { color:#009689; text-decoration:underline; }
    .vc-content ul, .vc-content ol { margin:0 0 14px; padding-left:20px; font-size:14px; color:#333; line-height:1.8; }
    .vc-content strong { color:#222; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0f7f4;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f7f4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 16px;text-align:center;">
              <h1 style="margin:0;font-size:28px;font-weight:700;color:#005044;letter-spacing:-0.5px;">Vidacure</h1>
              <hr style="border:none;border-top:2px solid #009689;margin:16px auto 0;width:80px;" />
            </td>
          </tr>

          <!-- Content (admin-authored) -->
          <tr>
            <td class="vc-content" style="padding:8px 32px 24px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#f0f7f4;text-align:center;border-top:1px solid #e0ebe8;">
              <p style="margin:0 0 4px;font-size:12px;color:#777;">&copy; 2026 Vidacure</p>
              <p style="margin:0;font-size:12px;">
                <a href="https://www.vidacure.se" style="color:#009689;text-decoration:none;">www.vidacure.se</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
