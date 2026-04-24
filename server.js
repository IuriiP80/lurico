require('dotenv').config();
const https = require('https');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FORMSPREE_ENDPOINT = process.env.FORMSPREE_ENDPOINT;
const GOOGLE_WEBHOOK_KEY = process.env.GOOGLE_WEBHOOK_KEY || '';

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

        res.on('data', (chunk) => {
          body += chunk;
        });

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
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let responseBody = '';

        res.on('data', (chunk) => {
          responseBody += chunk;
        });

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

function getFieldValue(arr, keys) {
  if (!Array.isArray(arr)) return '';

  const found = arr.find((item) => {
    const key = String(item.name || item.key || item.column_name || '')
      .trim()
      .toLowerCase();

    return keys.includes(key);
  });

  if (!found) return '';

  return found.value || found.field_value || found.answer || '';
}

function normalizeResults(results) {
  return results.map((result) => {
    if (result.status === 'fulfilled') {
      if (result.value && result.value.skipped) {
        return {
          delivered: false,
          skipped: true,
          details: result.value
        };
      }

      return {
        delivered: true,
        skipped: false,
        details: result.value
      };
    }

    return {
      delivered: false,
      skipped: false,
      details: result.reason?.message || String(result.reason)
    };
  });
}

app.get('/', (req, res) => {
  res.send('Lurico server is running');
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Website form
app.post('/send', async (req, res) => {
  try {
    console.log('Incoming /send:', req.body);

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
      `SMS Consent: ${sms_consent || 'No'}`
    ].join('\n');

    const formspreePayload = {
      name,
      phone,
      address,
      appliance,
      issue,
      message,
      sms_consent,
      source: 'lurico.us website form'
    };

    const rawResults = await Promise.allSettled([
      sendTelegram(text),
      sendToFormspree(formspreePayload)
    ]);

    const results = normalizeResults(rawResults);
    const delivered = results.some((item) => item.delivered);

    console.log('Results /send:', JSON.stringify(results, null, 2));

    if (!delivered) {
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
    console.error('Server error /send:', error);

    return res.status(500).json({
      ok: false,
      error: error.message || 'Server error'
    });
  }
});

// Google Ads webhook
app.post('/google-leads', async (req, res) => {
  try {
    console.log('Incoming /google-leads:', JSON.stringify(req.body, null, 2));

    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    const headerKey =
      req.headers['x-api-key'] ||
      req.headers['x-google-key'] ||
      req.headers['key'] ||
      '';

    const queryKey = req.query.key || '';
    const providedKey = bearer || headerKey || queryKey;

    if (GOOGLE_WEBHOOK_KEY && providedKey !== GOOGLE_WEBHOOK_KEY) {
      console.log('Webhook auth failed');

      return res.status(401).json({
        ok: false,
        error: 'Unauthorized'
      });
    }

    const body = req.body || {};
    const userColumnData =
      body.user_column_data ||
      body.lead_data ||
      body.form_data ||
      body.fields ||
      [];

    const fullName =
      getFieldValue(userColumnData, ['full name', 'name', 'full_name']) ||
      body.full_name ||
      body.name ||
      '';

    const phone =
      getFieldValue(userColumnData, ['phone number', 'phone', 'mobile phone']) ||
      body.phone_number ||
      body.phone ||
      '';

    const email =
      getFieldValue(userColumnData, ['email', 'email address']) ||
      body.email ||
      '';

    const city =
      getFieldValue(userColumnData, ['city']) ||
      body.city ||
      '';

    const zip =
      getFieldValue(userColumnData, ['zip/postal code', 'zip code', 'postal code', 'zip']) ||
      body.zip ||
      '';

    const appliance =
      getFieldValue(userColumnData, ['what appliance needs repair?']) ||
      body.appliance ||
      '';

    const text = [
      'New Google Ads Lead',
      `Name: ${fullName || '-'}`,
      `Phone: ${phone || '-'}`,
      `Email: ${email || '-'}`,
      `City: ${city || '-'}`,
      `ZIP: ${zip || '-'}`,
      `Appliance: ${appliance || '-'}`
    ].join('\n');

    const formspreePayload = {
      name: fullName,
      phone,
      email,
      city,
      zip,
      appliance,
      source: 'google ads lead form'
    };

    const rawResults = await Promise.allSettled([
      sendTelegram(text),
      sendToFormspree(formspreePayload)
    ]);

    const results = normalizeResults(rawResults);

    console.log('Results /google-leads:', JSON.stringify(results, null, 2));

    return res.status(200).json({
      ok: true,
      results
    });
  } catch (error) {
    console.error('Server error /google-leads:', error);

    return res.status(200).json({
      ok: false,
      error: error.message || 'Webhook error'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
