require('dotenv').config();
const https = require('https');
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM || '+15619561773';
const ALERT_TO = process.env.ALERT_TO || '+19543055539';
const GOOGLE_WEBHOOK_KEY = process.env.GOOGLE_WEBHOOK_KEY || '';

const client =
  TWILIO_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_SID, TWILIO_AUTH_TOKEN)
    : null;

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
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`Telegram error ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendSms(text) {
  if (!client) return;
  return client.messages.create({
    body: text,
    from: TWILIO_FROM,
    to: ALERT_TO,
  });
}

app.get('/', (req, res) => {
  res.status(200).send('Lurico server is running');
});

// форма с сайта
app.post('/send', async (req, res) => {
  const {
    name = 'N/A',
    phone = 'N/A',
    address = 'N/A',
    appliance = 'N/A',
    issue = 'N/A',
    message = 'N/A',
  } = req.body || {};

  const text = `🔥 New Service Request:
Name: ${name}
Phone: ${phone}
Address: ${address}
Appliance: ${appliance}
Issue: ${issue}
Message: ${message}`;

  try {
    await Promise.allSettled([
      sendTelegram(text),
      sendSms(text),
    ]);

    console.log('Website lead received:', req.body);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('SEND route error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Google Ads webhook
app.post('/google-lead', async (req, res) => {
  const lead = req.body || {};

  try {
    console.log('GOOGLE LEAD RAW:', JSON.stringify(lead, null, 2));

    // Проверка ключа именно так, как Google обычно шлет
    if (GOOGLE_WEBHOOK_KEY && lead.google_key !== GOOGLE_WEBHOOK_KEY) {
      console.error('Invalid google_key:', lead.google_key);
      return res.status(403).send('Forbidden');
    }

    const fields = Array.isArray(lead.user_column_data)
      ? lead.user_column_data
      : [];

    const getField = (columnId) => {
      const item = fields.find((x) => x.column_id === columnId);
      return item?.string_value || 'N/A';
    };

    const name = getField('FULL_NAME');
    const phone = getField('PHONE_NUMBER');
    const email = getField('EMAIL');
    const city = getField('CITY');
    const postalCode = getField('POSTAL_CODE');

    const customFields = fields
      .filter(
        (x) =>
          !['FULL_NAME', 'PHONE_NUMBER', 'EMAIL', 'CITY', 'POSTAL_CODE'].includes(
            x.column_id
          )
      )
      .map((x) => `${x.column_id}: ${x.string_value || 'N/A'}`)
      .join('\n');

    const text = `🔥 Google Lead:
Lead ID: ${lead.lead_id || 'N/A'}
Test: ${lead.is_test ? 'YES' : 'NO'}
Name: ${name}
Phone: ${phone}
Email: ${email}
City: ${city}
ZIP: ${postalCode}${customFields ? `\n${customFields}` : ''}`;

    // Сначала отвечаем Google, чтобы тест проходил
    res.sendStatus(200);

    // Потом уже отправляем уведомления
    const results = await Promise.allSettled([
      sendTelegram(text),
      sendSms(text),
    ]);

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(index === 0 ? 'Telegram error:' : 'SMS error:', result.reason);
      }
    });
  } catch (error) {
    console.error('Google lead error:', error);

    if (!res.headersSent) {
      res.sendStatus(200);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
