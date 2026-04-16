require('dotenv').config();

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
