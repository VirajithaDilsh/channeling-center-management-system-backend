// Sends transactional email via the Brevo (Sendinblue) REST API — free tier,
// no SMTP app-password/2FA requirement. Uses Node's built-in fetch (Node 18+).
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

async function sendMail({ replyTo, subject, text, html }) {
  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_SENDER_EMAIL, name: "Contact Us Form" },
      to: [{ email: process.env.CONTACT_RECIPIENT_EMAIL }],
      replyTo: { email: replyTo },
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API error (${res.status}): ${body}`);
  }
}

module.exports = { sendMail };
