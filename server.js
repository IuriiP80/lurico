require('dotenv').config();
const https = require('https');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return resolve();

    const data = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text });

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
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ✅ ТВОЙ SID (ты уже дал)
const accountSid = process.env.TWILIO_SID;

// ❗ ВСТАВЬ СВОЙ AUTH TOKEN ИЗ TWILIO
const authToken = process.env.TWILIO_AUTH_TOKEN;
console.log('SID:', process.env.TWILIO_SID);

console.log('TOKEN OK:', !!process.env.TWILIO_AUTH_TOKEN);
const client = twilio(accountSid, authToken);

app.post('/send', async (req, res) => {
  const { name, phone, address, appliance, issue, message } = req.body;

  try {
    await client.messages.create({
      body: `🔥 New Service Request:
Name: ${name}
Phone: ${phone}
Address: ${address}
Appliance: ${appliance}
Issue: ${issue}
Message: ${message}`,
      from: '+15619561773',   // твой Twilio номер
      to: '+19543055539'      // твой личный номер
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

app.listen(3000, () => {
  console.log('🚀 Server running on port 3000');
});
