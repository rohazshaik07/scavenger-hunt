require('dotenv').config();
console.log('MONGODB_URI:', process.env.MONGODB_URI);

const express = require('express');
const mongoose = require('mongoose');
mongoose.set('strictQuery', true);
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── MongoDB Connection Setup ────────────────────────────────────────────────
let mongooseConnection = null;

async function connectToMongoDB() {
  if (mongooseConnection) {
    console.log('Reusing existing MongoDB connection');
    return mongooseConnection;
  }

  try {
    console.log('Connecting to MongoDB...');
    mongooseConnection = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
    return mongooseConnection;
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    throw err;
  }
}

// Middleware to ensure MongoDB connection
app.use(async (req, res, next) => {
  try {
    await connectToMongoDB();
    next();
  } catch (err) {
    res.status(500).send('Failed to connect to MongoDB: ' + err.message);
  }
});

// ─── Routes ─────────────────────────────────────────────────────────────────
// Test endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.send('MongoDB connection successful!');
  } catch (err) {
    res.status(500).send('MongoDB connection failed: ' + err.message);
  }
});

// Participant Model
const participantSchema = new mongoose.Schema({
  registrationNumber: String,
  components: [String],
});
const Participant = mongoose.model('Participant', participantSchema);

// Scan Endpoint
const validCodes = ['abc123', 'def456', 'ghi789', 'jkl012', 'mno345'];
const scanLimiter = rateLimit({ windowMs: 60000, max: 1 });

app.get('/api/scan', scanLimiter, async (req, res) => {
  const { code } = req.query;
  const regNum = req.cookies.registrationNumber;

  if (!validCodes.includes(code)) {
    return res.status(400).send('<h1>Invalid QR Code</h1>');
  }

  if (!regNum) {
    res.send(`
      <h1>Registration Required</h1>
      <form action="/api/register" method="post">
        <input type="text" name="registrationNumber" placeholder="A12345" required>
        <input type="hidden" name="code" value="${code}">
        <button type="submit">Submit</button>
      </form>
    `);
  } else {
    await logScan(regNum, code);
    res.send(await showProgress(regNum));
  }
});

// Registration Endpoint
app.post('/api/register', async (req, res) => {
  const { registrationNumber, code } = req.body;
  
  if (!registrationNumber.match(/^[A-Z0-9]+$/)) {
    return res.status(400).send('Invalid registration number format');
  }

  res.cookie('registrationNumber', registrationNumber, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  
  await logScan(registrationNumber, code);
  res.send(await showProgress(registrationNumber));
});

// ─── Helpers ────────────────────────────────────────────────────────────────
async function logScan(regNum, code) {
  let participant = await Participant.findOne({ registrationNumber: regNum }) || 
                    new Participant({ registrationNumber: regNum, components: [] });
  
  if (!participant.components.includes(code)) {
    participant.components.push(code);
    await participant.save();
  }
}

async function showProgress(regNum) {
  const participant = await Participant.findOne({ registrationNumber: regNum });
  const progress = participant?.components?.length || 0;
  
  return `
    <h1>Progress: ${progress}/5</h1>
    ${progress >= 5 ? '<p>Congratulations! You won!</p>' : '<p>Keep scanning!</p>'}
  `;
}

// ─── Server Setup ───────────────────────────────────────────────────────────
// Export for Vercel
module.exports = app;

// Start locally when not in production
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}