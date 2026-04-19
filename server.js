require('dotenv').config();
const https = require('https');
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ENV
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;
const ALERT_TO = process.env.ALERT_TO;
const WEBHOOK_KEY = process.env.GOOGLE_WEBHOOK_KEY;

const client = twilio(TWILIO_SID, TWILIO_AUTH);

// TELEGRAM
function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return resolve();

    const data = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
    });

    const req = https.request(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ПРОСТАЯ ПРОВЕРКА
app.get('/', (req, res) => {
  res.send('🚀 Lurico server is running');
});

// GOOGLE LEADS WEBHOOK
app.post('/google-lead', async (req, res) => {
  try {
    // защита
    if (WEBHOOK_KEY) {
      const key = req.headers['authorization'] || req.query.key;
      if (key !== WEBHOOK_KEY) {
        return res.status(403).send('Forbidden');
      }
    }

    const lead = req.body || {};

    const name = lead.full_name || lead.name || 'N/A';
    const phone = lead.phone_number || lead.phone || 'N/A';
    const email = lead.email || 'N/A';

    const text = `🔥 Google Lead:
Name: ${name}
Phone: ${phone}
Email: ${email}`;

    // Telegram
    await sendTelegram(text);

    // SMS
    if (TWILIO_SID) {
      await client.messages.create({
        body: text,
        from: TWILIO_FROM,
        to: ALERT_TO,
      });
    }

    console.log('✅ Lead received:', lead);

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ ERROR:', err);
    res.status(500).send('Error');
  }
});

app.listen(3000, () => {
  console.log('🚀 Server running on port 3000');
});
