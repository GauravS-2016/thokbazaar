require('dotenv').config();
const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// Sends an email. If SMTP is not configured, prints it to the console instead
// so everything still works while you are testing.
async function sendMail(to, subject, text) {
  if (!transporter) {
    console.log(`[email not configured] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
  } catch (err) {
    console.error('Email failed for', to, err.message);
  }
}

module.exports = { sendMail };
