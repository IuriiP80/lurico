require('dotenv').config();
const https = require('https');
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const cors = require('cors');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

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

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

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
      from: '+15619561773',
      to: '+19543055539'
    });

    const telegramText = `🩾 Lurico request:
Name: ${name}
Phone: ${phone}
Address: ${address}
Appliance: ${appliance}
Issue: ${issue}
Message: ${message}`;

    await sendTelegram(telegramText);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

app.post('/google-lead', async (req, res) => {
  try {
    const lead = req.body;

    const telegramText = `🔥 New Google Lead:
Name: ${lead.full_name || lead.name || 'N/A'}
Phone: ${lead.phone_number || lead.phone || 'N/A'}
Email: ${lead.email || 'N/A'}`;

    await sendTelegram(telegramText);

    res.sendStatus(200);
  } catch (error) {
    console.error('Google lead error:', error);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log('🚀 Server running on port 3000');
});
