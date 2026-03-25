import { Resend } from "resend";

// ⚠️ TEST MODE: Override recipient to Resend account owner's email.
// Remove this constant and the override below when switching to production.

// const TEST_OVERRIDE_EMAIL = "aw736024@gmail.com";

const resend = new Resend(process.env.RESEND_API_KEY);

type LabTestOrderEmailParams = {
  to: string;
  patientName: string;
  testPackageName: string;
  testPackageNameSv: string;
  price: string;
  orderedAt: Date;
};

export const sendLabTestOrderConfirmation = async (
  params: LabTestOrderEmailParams
): Promise<void> => {
  const { testPackageName, testPackageNameSv, price, orderedAt } = params;
  const to = params.to;
  const from = process.env.RESEND_FROM_EMAIL || "info@vidacure.se";

  const formattedDate = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(orderedAt));

  const html = `
<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Orderbekräftelse – Vidacure</title>
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

          <!-- Order Confirmation Banner -->
          <tr>
            <td style="padding:8px 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#e6f5f3;border-radius:8px;border-left:4px solid #009689;">
                <tr>
                  <td style="padding:20px 24px;">
                    <h2 style="margin:0 0 12px;font-size:20px;color:#005044;">Tack för din beställning!</h2>
                    <p style="margin:0 0 4px;font-size:14px;color:#333;">
                      <strong>Paket:</strong> ${testPackageNameSv} (${testPackageName})
                    </p>
                    <p style="margin:0 0 4px;font-size:14px;color:#333;">
                      <strong>Pris:</strong> ${price}
                    </p>
                    <p style="margin:0;font-size:14px;color:#333;">
                      <strong>Datum:</strong> ${formattedDate}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Provtagning -->
          <tr>
            <td style="padding:0 32px 20px;">
              <h3 style="margin:0 0 8px;font-size:17px;color:#005044;">Provtagning</h3>
              <p style="margin:0;font-size:14px;color:#444;line-height:1.6;">
                Vid övervikt och obesitas rekommenderas provtagning som en viktig del av den medicinska utredningen. Enligt gällande riktlinjer behöver man utvärdera individens hjärtkärlmässiga riskprofil innan behandling påbörjas, särskilt om BMI ligger mellan 27–29. Blodprover hjälper till att identifiera riskfaktorer för hjärt–kärlsjukdom, diabetes och andra relaterade tillstånd, och ger en säker grund för att planera rätt behandling och uppföljning.
              </p>
            </td>
          </tr>

          <!-- Evidensbaserad riskprofilering -->
          <tr>
            <td style="padding:0 32px 20px;">
              <h3 style="margin:0 0 8px;font-size:17px;color:#005044;">Evidensbaserad riskprofilering för hjärt–kärlsjukdom, diabetes och relaterade tillstånd</h3>
              <p style="margin:0 0 8px;font-size:14px;color:#444;line-height:1.6;">
                Vid övervikt och obesitas ökar risken för hjärt–kärlsjukdomar, diabetes och andra kroniska tillstånd. Därför är det viktigt att regelbundet kontrollera vissa blodprover för att tidigt upptäcka avvikelser och kunna sätta in rätt behandling i tid. Vårt provtagningsprogram bygger på aktuell evidens och riktlinjer för preventivt hälsoarbete och ger dig en tydlig, medicinskt relevant bild av din hälsostatus.
              </p>
              <p style="margin:0 0 8px;font-size:14px;color:#444;line-height:1.6;">
                Efter provtagningen går en läkare igenom dina resultat och ger en skriftlig medicinsk återkoppling med rekommendationer för fortsatt behandling. Om något värde avviker på ett sätt som kräver vidare utredning hänvisar vi dig till din vårdcentral. Instruktioner för hur provtagningen går till kommer du att få när du beställer dina prover.
              </p>
            </td>
          </tr>

          <!-- Våra provpaket -->
          <tr>
            <td style="padding:0 32px 8px;">
              <h3 style="margin:0 0 8px;font-size:17px;color:#005044;">Basprov – ingår i medicinskt/livsstilsprogrammet</h3>
              <p style="margin:0 0 8px;font-size:14px;color:#444;line-height:1.6;">
                Detta paket innehåller de prover som enligt riktlinjer är nödvändiga för att bedöma risk för hjärt–kärlsjukdom, diabetes och relaterade tillstånd.
              </p>
              <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#444;line-height:1.8;">
                <li>Blodfetter (kolesterol, LDL, HDL, triglycerider avslöjar om man har hyperlipidemi)</li>
                <li>Faste-glukos och HbA1c (långtidssocker, dessa tas för att screena för förhöjt blodsocker prediabetes eller diabete)</li>
                <li>Leverprover (Förhöjda leverprover kan tyda på fettlever)</li>
                <li>Njurfunktion (Njursvikt kan tyda på kärlsjukdom)</li>
                <li>Blodstatus (Blodvärde och relaterade prover om blodkroppar)</li>
                <li>Sköldkörtelprov (Viktigt att utesluta undersfunktion av sköldkörtel)</li>
              </ul>
            </td>
          </tr>

          <!-- Synlab Links -->
          <tr>
            <td style="padding:0 32px 24px;">
              <h3 style="margin:0 0 8px;font-size:17px;color:#005044;">Hitta ett provtagningsställe</h3>
              <p style="margin:0 0 8px;font-size:14px;color:#444;line-height:1.6;">
                Du kan lämna dina prover hos Synlab. Hitta ditt närmaste provtagningsställe:
              </p>
              <p style="margin:0 0 4px;font-size:14px;">
                <a href="https://synlab.se/patient/har-finns-vi" style="color:#009689;text-decoration:underline;">synlab.se/patient/har-finns-vi</a>
              </p>
              <p style="margin:0;font-size:14px;">
                <a href="https://synlab.se/patient/har-finns-vi/provtagningspartners" style="color:#009689;text-decoration:underline;">synlab.se/patient/har-finns-vi/provtagningspartners</a>
              </p>
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

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: `Orderbekräftelse – ${testPackageNameSv}`,
      html,
    });

    if (error) {
      console.error("Resend API error sending lab test confirmation email:", error);
    } else {
      console.log("Lab test order confirmation email sent to:", to);
    }
  } catch (err) {
    console.error("Failed to send lab test order confirmation email:", err);
  }
};

type WelcomeEmailParams = {
  to: string;
  patientName: string;
};

export const sendWelcomeEmail = async (
  params: WelcomeEmailParams
): Promise<void> => {
  const { patientName , to } = params;
  // const to = params.to;
  const from = process.env.RESEND_FROM_EMAIL || "info@vidacure.se";

  const html = `
<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Välkommen till Vidacure</title>
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

          <!-- Welcome Message -->
          <tr>
            <td style="padding:8px 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#e6f5f3;border-radius:8px;border-left:4px solid #009689;">
                <tr>
                  <td style="padding:20px 24px;">
                    <h2 style="margin:0 0 12px;font-size:20px;color:#005044;">Välkommen, ${patientName}!</h2>
                    <p style="margin:0;font-size:14px;color:#333;line-height:1.6;">
                      Tack för att du har registrerat dig hos Vidacure. Vi ser fram emot att hjälpa dig på din hälsoresa.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 24px;text-align:center;">
              <p style="margin:0 0 16px;font-size:14px;color:#444;line-height:1.6;">
                Utforska våra planer och ta nästa steg mot en hälsosammare livsstil.
              </p>
              <a href="https://www.vidacure.se" style="display:inline-block;padding:12px 28px;background-color:#009689;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">
                Besök vidacure.se
              </a>
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

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "Välkommen till Vidacure",
      html,
    });

    if (error) {
      console.error("Resend API error sending welcome email:", error);
    } else {
      console.log("Welcome email sent to:", to);
    }
  } catch (err) {
    console.error("Failed to send welcome email:", err);
  }
};

// ── Booking Confirmation Email ──────────────────────────────────────

type BookingConfirmationEmailParams = {
  to: string;
  patientName: string;
  eventName: string;
  scheduledTime: Date;
  endTime?: Date;
  meetingUrl?: string;
  cancelUrl?: string;
  rescheduleUrl?: string;
  hostName?: string;
};

export const sendBookingConfirmation = async (
  params: BookingConfirmationEmailParams
): Promise<void> => {
  const {
    patientName,
    eventName,
    scheduledTime,
    endTime,
    meetingUrl,
    cancelUrl,
    rescheduleUrl,
    hostName,
  } = params;
  const to = params.to;
  const from = process.env.RESEND_FROM_EMAIL || "info@vidacure.se";

  const dateFmt = new Intl.DateTimeFormat("sv-SE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const formattedDate = dateFmt.format(new Date(scheduledTime));
  const formattedStart = timeFmt.format(new Date(scheduledTime));
  const formattedEnd = endTime ? timeFmt.format(new Date(endTime)) : null;
  const timeRange = formattedEnd
    ? `${formattedStart} – ${formattedEnd}`
    : formattedStart;

  const joinSection = meetingUrl
    ? `<tr>
        <td style="padding:0 32px 24px;text-align:center;">
          <a href="${meetingUrl}" style="display:inline-block;padding:14px 32px;background-color:#009689;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
            Anslut till mötet
          </a>
        </td>
      </tr>`
    : "";

  const linksSection =
    cancelUrl || rescheduleUrl
      ? `<tr>
          <td style="padding:0 32px 24px;text-align:center;">
            ${rescheduleUrl ? `<a href="${rescheduleUrl}" style="color:#009689;font-size:13px;text-decoration:underline;margin-right:16px;">Boka om</a>` : ""}
            ${cancelUrl ? `<a href="${cancelUrl}" style="color:#999;font-size:13px;text-decoration:underline;">Avboka</a>` : ""}
          </td>
        </tr>`
      : "";

  const html = `
<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bokningsbekräftelse – Vidacure</title>
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

          <!-- Confirmation Banner -->
          <tr>
            <td style="padding:8px 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#e6f5f3;border-radius:8px;border-left:4px solid #009689;">
                <tr>
                  <td style="padding:20px 24px;">
                    <h2 style="margin:0 0 12px;font-size:20px;color:#005044;">Din bokning är bekräftad!</h2>
                    <p style="margin:0;font-size:14px;color:#333;line-height:1.6;">
                      Hej ${patientName}, din tid hos Vidacure är bokad.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Meeting Details -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0ebe8;border-radius:8px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:0 0 12px;font-size:13px;color:#777;width:110px;vertical-align:top;">Typ</td>
                        <td style="padding:0 0 12px;font-size:14px;color:#333;font-weight:600;">${eventName}</td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 12px;font-size:13px;color:#777;vertical-align:top;">Datum</td>
                        <td style="padding:0 0 12px;font-size:14px;color:#333;font-weight:600;">${formattedDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 ${hostName ? "12px" : "0"};font-size:13px;color:#777;vertical-align:top;">Tid</td>
                        <td style="padding:0 0 ${hostName ? "12px" : "0"};font-size:14px;color:#333;font-weight:600;">${timeRange}</td>
                      </tr>
                      ${hostName ? `<tr>
                        <td style="padding:0;font-size:13px;color:#777;vertical-align:top;">Värd</td>
                        <td style="padding:0;font-size:14px;color:#333;font-weight:600;">${hostName}</td>
                      </tr>` : ""}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Join Meeting Button -->
          ${joinSection}

          <!-- Reschedule / Cancel Links -->
          ${linksSection}

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

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: `Bokningsbekräftelse – ${eventName}`,
      html,
    });

    if (error) {
      console.error("Resend API error sending booking confirmation:", error);
    } else {
      console.log("Booking confirmation email sent to:", to);
    }
  } catch (err) {
    console.error("Failed to send booking confirmation email:", err);
  }
};

// ── Booking Cancellation Email ──────────────────────────────────────

type BookingCancellationEmailParams = {
  to: string;
  patientName: string;
  eventName: string;
  scheduledTime: Date;
};

export const sendBookingCancellation = async (
  params: BookingCancellationEmailParams
): Promise<void> => {
  const { patientName, eventName, scheduledTime } = params;
  const to = params.to;
  const from = process.env.RESEND_FROM_EMAIL || "info@vidacure.se";

  const dateFmt = new Intl.DateTimeFormat("sv-SE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const formattedDate = dateFmt.format(new Date(scheduledTime));
  const formattedTime = timeFmt.format(new Date(scheduledTime));

  const html = `
<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Avbokning – Vidacure</title>
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

          <!-- Cancellation Banner -->
          <tr>
            <td style="padding:8px 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3f2;border-radius:8px;border-left:4px solid #dc2626;">
                <tr>
                  <td style="padding:20px 24px;">
                    <h2 style="margin:0 0 12px;font-size:20px;color:#991b1b;">Din bokning har avbokats</h2>
                    <p style="margin:0;font-size:14px;color:#333;line-height:1.6;">
                      Hej ${patientName}, följande bokning har avbokats:
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Details -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0ebe8;border-radius:8px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:0 0 12px;font-size:13px;color:#777;width:110px;">Typ</td>
                        <td style="padding:0 0 12px;font-size:14px;color:#333;font-weight:600;">${eventName}</td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 12px;font-size:13px;color:#777;">Datum</td>
                        <td style="padding:0 0 12px;font-size:14px;color:#333;font-weight:600;">${formattedDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:0;font-size:13px;color:#777;">Tid</td>
                        <td style="padding:0;font-size:14px;color:#333;font-weight:600;">${formattedTime}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Rebook CTA -->
          <tr>
            <td style="padding:0 32px 24px;text-align:center;">
              <p style="margin:0 0 16px;font-size:14px;color:#444;line-height:1.6;">
                Vill du boka en ny tid? Logga in på Vidacure för att boka.
              </p>
              <a href="https://www.vidacure.se" style="display:inline-block;padding:12px 28px;background-color:#009689;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">
                Boka ny tid
              </a>
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

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: `Avbokning – ${eventName}`,
      html,
    });

    if (error) {
      console.error("Resend API error sending cancellation email:", error);
    } else {
      console.log("Booking cancellation email sent to:", to);
    }
  } catch (err) {
    console.error("Failed to send booking cancellation email:", err);
  }
};
