const { sendMail } = require("../utils/mailer");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.sendContactMessage = async (req, res) => {
  const { name, email, message, honeypot } = req.body;

  // Honeypot field is invisible to real users; a filled value means a bot.
  // Pretend success so the bot doesn't learn to adapt.
  if (honeypot) {
    return res.json({ message: "Your message has been sent successfully." });
  }

  const trimmedName = (name || "").trim();
  const trimmedEmail = (email || "").trim();
  const trimmedMessage = (message || "").trim();

  if (!trimmedName || !trimmedEmail || !trimmedMessage) {
    return res.status(400).json({ message: "Name, email and message are required." });
  }
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return res.status(400).json({ message: "Please provide a valid email address." });
  }
  if (trimmedName.length > 200 || trimmedMessage.length > 5000) {
    return res.status(400).json({ message: "Name or message is too long." });
  }

  try {
    await sendMail({
      replyTo: trimmedEmail,
      subject: `New Contact Us message from ${trimmedName}`,
      text: `Name: ${trimmedName}\nEmail: ${trimmedEmail}\n\n${trimmedMessage}`,
      html: `<p><strong>Name:</strong> ${trimmedName}</p><p><strong>Email:</strong> ${trimmedEmail}</p><p>${trimmedMessage.replace(/\n/g, "<br/>")}</p>`,
    });
    res.json({ message: "Your message has been sent successfully." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
