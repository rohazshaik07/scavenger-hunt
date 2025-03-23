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

// Optimize MongoDB connection for serverless
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

// Connect to MongoDB before handling requests
app.use(async (req, res, next) => {
  try {
    await connectToMongoDB();
    next();
  } catch (err) {
    res.status(500).send('Failed to connect to MongoDB: ' + err.message);
  }
});

// Test endpoint to check MongoDB connection
app.get('/api/test-db', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.send('MongoDB connection successful!');
  } catch (err) {
    res.status(500).send('MongoDB connection failed: ' + err.message);
  }
});

// Participant Schema
const participantSchema = new mongoose.Schema({
  registrationNumber: String,
  components: [String], // Array of scanned QR codes
});
const Participant = mongoose.model('Participant', participantSchema);

// Valid QR codes
const validCodes = ['abc123', 'def456', 'ghi789', 'jkl012', 'mno345'];

// Rate limiter to prevent rapid scans
const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1, // 1 scan per minute per IP
  message: 'Please wait a minute before scanning again.',
});

// Scan endpoint
app.get('/api/scan', scanLimiter, async (req, res) => {
  const { code } = req.query;
  const registrationNumber = req.cookies.registrationNumber;

  // Check if QR code is valid
  if (!validCodes.includes(code)) {
    return res.status(400).send('<h1>Invalid QR Code</h1>');
  }

  if (!registrationNumber) {
    // No cookie, show registration form
    res.send(`
      <h1>Enter Your Registration Number</h1>
      <form action="/api/register" method="post">
        <input type="text" name="registrationNumber" placeholder="e.g., A12345" required />
        <input type="hidden" name="code" value="${code}" />
        <button type="submit">Submit</button>
      </form>
      <p><strong>Important:</strong> Please enable cookies to participate in the scavenger hunt.</p>
    `);
  } else {
    // Cookie exists, log scan and show progress
    await logScan(registrationNumber, code);
    res.send(await showProgress(registrationNumber));
  }
});

// Register endpoint
app.post('/api/register', async (req, res) => {
  const { registrationNumber, code } = req.body;

  // Validate registration number (basic example: alphanumeric)
  if (!registrationNumber.match(/^[A-Z0-9]+$/)) {
    return res.status(400).send('<h1>Invalid Registration Number</h1><p>Use only letters and numbers.</p>');
  }

  // Set cookie and log scan
  res.cookie('registrationNumber', registrationNumber, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Enable secure cookies in production
    sameSite: 'lax',
  });
  await logScan(registrationNumber, code);
  res.send(await showProgress(registrationNumber));
});

// Helper: Log a scan
async function logScan(registrationNumber, code) {
  let participant = await Participant.findOne({ registrationNumber });
  if (!participant) {
    participant = new Participant({
      registrationNumber,
      components: [],
    });
  }
  if (!participant.components.includes(code)) {
    participant.components.push(code);
    await participant.save();
  }
}

// Helper: Show progress
async function showProgress(registrationNumber) {
  const participant = await Participant.findOne({ registrationNumber });
  const progress = participant.components.length;
  return `
    <h1>Component Collected!</h1>
    <p>Progress: ${progress}/5</p>
    ${progress === 5 ? '<p><strong>Congratulations! You’ve completed the hunt!</strong></p>' : '<p>Scan the next QR code!</p>'}
  `;
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).send('Something broke! Error: ' + err.message);
});

// Export the app for Vercel
module.exports = app;