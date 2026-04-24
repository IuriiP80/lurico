require('dotenv').config();
const https = require('https');
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FORMSPREE_ENDPOINT = process.env.FORMSPREE_ENDPOINT;

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      return resolve({ skipped: true, reason: 'Telegram env missing' });
    }

    const data = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text
    });

    const req = https.request(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, body });
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

function sendToFormspree(payload) {
  return new Promise((resolve, reject) => {
    if (!FORMSPREE_ENDPOINT) {
      return resolve({ skipped: true, reason: 'Formspree env missing' });
    }

    const body = JSON.stringify(payload);
    const url = new URL(FORMSPREE_ENDPOINT);

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => (responseBody += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, body: responseBody });
          } else {
            reject(new Error(`Formspree error ${res.statusCode}: ${responseBody}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

app.post('/send', async (req, res) => {
  try {
    console.log('Incoming /send:', req.body);
    console.log('Telegram configured:', !!TELEGRAM_TOKEN, !!TELEGRAM_CHAT_ID);
    console.log('Formspree configured:', !!FORMSPREE_ENDPOINT);

    const {
      name = '',
      phone = '',
      address = '',
      appliance = '',
      issue = '',
      message = '',
      sms_consent = 'No'
    } = req.body || {};

    if (!name.trim() || !phone.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Name and phone are required'
      });
    }

    const text = [
      'New service request',
      `Name: ${name}`,
      `Phone: ${phone}`,
      `Address: ${address || '-'}`,
      `Appliance: ${appliance || '-'}`,
      `Issue: ${issue || '-'}`,
      `Message: ${message || '-'}`,
      `SMS Consent: ${sms_consent}`
    ].join('\n');

    const formspreePayload = {
      name,
      phone,
      address,
      appliance,
      issue,
      message,
      sms_consent,
      source: 'lurico.us'
    };

    const results = await Promise.allSettled([
      sendTelegram(text),
      sendToFormspree(formspreePayload)
    ]);

    const normalized = results.map((r) => {
      if (r.status !== 'fulfilled') {
        return { delivered: false, raw: r.reason?.message || r.reason || r };
      }
      if (r.value && r.value.skipped) {
        return { delivered: false, raw: r.value };
      }
      return { delivered: true, raw: r.value };
    });

    const atLeastOneWorked = normalized.some((r) => r.delivered);

    console.log('Delivery results:', JSON.stringify(results, null, 2));

    if (!atLeastOneWorked) {
      return res.status(500).json({
        ok: false,
        error: 'All delivery methods failed',
        results
      });
    }

    return res.json({
      ok: true,
      results
    });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Server error'
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
