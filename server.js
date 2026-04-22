require('dotenv').config();
const https = require('https');
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM || '+15619561773';
const ALERT_TO = process.env.ALERT_TO || '+19543055539';
const FORMSPREE_ENDPOINT = process.env.FORMSPREE_ENDPOINT || '';
const GOOGLE_WEBHOOK_KEY = process.env.GOOGLE_WEBHOOK_KEY || '';

const client =
  TWILIO_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_SID, TWILIO_AUTH_TOKEN)
    : null;

function sendToFormspree(payload) {
  return new Promise((resolve, reject) => {
    if (!FORMSPREE_ENDPOINT) {
      console.log('Formspree not configured');
      return resolve('Formspree not configured');
    }

    const url = new URL(FORMSPREE_ENDPOINT);
    const data = JSON.stringify(payload);

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
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
            reject(new Error(`Formspree error ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log('Telegram not configured');
      return resolve('Telegram not configured');
    }

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
  if (!client) {
    console.log('Twilio not configured');
    return 'Twilio not configured';
  }

  return client.messages.create({
    body: text,
    from: TWILIO_FROM,
    to: ALERT_TO,
  });
}

function logResults(results, labels) {
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.log(`${labels[index]} sent`);
    } else {
      console.error(`${labels[index]} error:`, result.reason);
    }
  });
}

app.get('/', (req, res) => {
  res.status(200).send('Lurico server is running');
});

app.post('/send', async (req, res) => {
  const {
    name = 'N/A',
    phone = 'N/A',
    address = 'N/A',
    appliance = 'N/A',
    issue = 'N/A',
    message = 'N/A',
    sms_consent = 'No',
  } = req.body || {};

  const payload = {
    name,
    phone,
    address,
    appliance,
    issue,
    message,
    sms_consent,
  };

  const text = `🔥 New Service Request:
Name: ${name}
Phone: ${phone}
Address: ${address}
Appliance: ${appliance}
Issue: ${issue}
Message: ${message}
SMS Consent: ${sms_consent}`;

  try {
    console.log('🔥 FORM DATA:', req.body);
    console.log('TELEGRAM_TOKEN exists:', !!TELEGRAM_TOKEN);
    console.log('TELEGRAM_CHAT_ID:', TELEGRAM_CHAT_ID);

    const results = await Promise.allSettled([
      sendTelegram(text),
      sendSms(text),
      sendToFormspree(payload),
    ]);

    logResults(results, ['Telegram', 'SMS', 'Formspree']);

    const atLeastOneSuccess = results.some(
      (result) => result.status === 'fulfilled'
    );

    if (!atLeastOneSuccess) {
      throw new Error('All delivery methods failed');
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('SEND route error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/google-lead', async (req, res) => {
  const lead = req.body || {};

  try {
    console.log('GOOGLE LEAD RAW:', JSON.stringify(lead, null, 2));

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

    const payload = {
      lead_id: lead.lead_id || 'N/A',
      is_test: lead.is_test ? 'YES' : 'NO',
      name,
      phone,
      email,
      city,
      postal_code: postalCode,
      custom_fields: customFields || '',
    };

    const text = `🔥 Google Lead:
Lead ID: ${lead.lead_id || 'N/A'}
Test: ${lead.is_test ? 'YES' : 'NO'}
Name: ${name}
Phone: ${phone}
Email: ${email}
City: ${city}
ZIP: ${postalCode}${customFields ? `\n${customFields}` : ''}`;

    res.sendStatus(200);

    const results = await Promise.allSettled([
      sendTelegram(text),
      sendSms(text),
      sendToFormspree(payload),
    ]);

    logResults(results, ['Telegram', 'SMS', 'Formspree']);
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
