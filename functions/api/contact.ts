interface Env {
  RESEND_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
}

const ALLOWED_SERVICES: Record<string, string> = {
  strategy: "IAM Strategy & Architecture",
  modernization: "Identity Modernization",
  implementation: "Implementation & Integration",
  managed: "Managed Identity & Support",
  other: "Other IAM Requirements",
};

const json = (data: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

function clean(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) => {
  try {
    const contentLength = Number(
      request.headers.get("content-length") || "0",
    );

    if (contentLength > 30000) {
      return json(
        {
          ok: false,
          message: "Your submission is too large.",
        },
        413,
      );
    }

    const form = await request.formData();

    const name = clean(form.get("name"), 100);
    const email = clean(form.get("email"), 254).toLowerCase();
    const company = clean(form.get("company"), 150);
    const role = clean(form.get("role"), 150);
    const service = clean(form.get("service"), 40);
    const message = String(form.get("message") ?? "")
      .trim()
      .slice(0, 5000);

    // Honeypot field. Legitimate users should never fill this.
    const website = clean(form.get("website"), 200);

    // Cloudflare Turnstile token.
    const turnstileToken = clean(
      form.get("cf-turnstile-response"),
      4096,
    );

    if (website) {
      return json({
        ok: true,
        message: "Your request has been received.",
      });
    }

    if (!name || name.length < 2) {
      return json(
        {
          ok: false,
          message: "Please enter your full name.",
        },
        400,
      );
    }

    if (!email || !isValidEmail(email)) {
      return json(
        {
          ok: false,
          message: "Please enter a valid work email address.",
        },
        400,
      );
    }

    if (!ALLOWED_SERVICES[service]) {
      return json(
        {
          ok: false,
          message: "Please select an area you need help with.",
        },
        400,
      );
    }

    if (!message || message.length < 10) {
      return json(
        {
          ok: false,
          message: "Please provide a little more detail about your requirements.",
        },
        400,
      );
    }

    if (!env.RESEND_API_KEY || !env.TURNSTILE_SECRET_KEY) {
      console.error("Contact form environment variables are not configured.");

      return json(
        {
          ok: false,
          message:
            "The contact form is temporarily unavailable. Please try again later.",
        },
        500,
      );
    }

    if (!turnstileToken) {
      return json(
        {
          ok: false,
          message: "Please complete the security verification.",
        },
        400,
      );
    }

    /*
     * Verify Cloudflare Turnstile.
     */
    const turnstileResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: turnstileToken,
          remoteip:
            request.headers.get("CF-Connecting-IP") || undefined,
        }),
      },
    );

    if (!turnstileResponse.ok) {
      console.error(
        "Turnstile verification request failed:",
        turnstileResponse.status,
      );

      return json(
        {
          ok: false,
          message:
            "We could not verify the submission. Please try again.",
        },
        400,
      );
    }

    const turnstileResult = (await turnstileResponse.json()) as {
      success?: boolean;
    };

    if (!turnstileResult.success) {
      return json(
        {
          ok: false,
          message:
            "We could not verify the submission. Please try again.",
        },
        400,
      );
    }

    /*
     * Send the inquiry through Resend.
     */
    const serviceLabel = ALLOWED_SERVICES[service];

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeCompany = escapeHtml(company || "Not provided");
    const safeRole = escapeHtml(role || "Not provided");
    const safeService = escapeHtml(serviceLabel);
    const safeMessage = escapeHtml(message).replace(/\n/g, "<br />");

    const resendResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Isocore Solutions <hr@isocoresolutions.com>",
          to: ["hr@isocoresolutions.com"],
          reply_to: email,
          subject: `IAM Assessment Request — ${name}`,
          text: [
            "New IAM Assessment Request",
            "",
            `Name: ${name}`,
            `Email: ${email}`,
            `Company: ${company || "Not provided"}`,
            `Role: ${role || "Not provided"}`,
            `Service: ${serviceLabel}`,
            "",
            "Message:",
            message,
          ].join("\n"),
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#061426;max-width:720px;">
              <h2 style="margin:0 0 24px;">New IAM Assessment Request</h2>

              <table style="border-collapse:collapse;width:100%;margin-bottom:28px;">
                <tr>
                  <td style="padding:8px 0;font-weight:700;width:140px;">Name</td>
                  <td style="padding:8px 0;">${safeName}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-weight:700;">Email</td>
                  <td style="padding:8px 0;">${safeEmail}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-weight:700;">Company</td>
                  <td style="padding:8px 0;">${safeCompany}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-weight:700;">Role</td>
                  <td style="padding:8px 0;">${safeRole}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-weight:700;">Service</td>
                  <td style="padding:8px 0;">${safeService}</td>
                </tr>
              </table>

              <h3 style="margin:0 0 10px;">Environment / Requirements</h3>

              <div style="padding:18px;background:#f7fafc;border:1px solid #d8e5ef;">
                ${safeMessage}
              </div>
            </div>
          `,
        }),
      },
    );

    if (!resendResponse.ok) {
      const resendError = await resendResponse.text();

      console.error(
        "Resend email request failed:",
        resendResponse.status,
        resendError,
      );

      return json(
        {
          ok: false,
          message:
            "We could not send your request right now. Please try again.",
        },
        502,
      );
    }

    return json({
      ok: true,
      message:
        "Your request has been received. We'll be in touch shortly.",
    });
  } catch (error) {
    console.error("Contact form error:", error);

    return json(
      {
        ok: false,
        message:
          "Something went wrong while submitting your request. Please try again.",
      },
      500,
    );
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
    },
  });