const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For form data
app.use(cookieParser());

// Connect to MongoDB (replace with your connection string)
mongoose.connect('mongodb+srv://shaikrohaz:hk58a9pSW7e3zjYp@scavenger-hunt.b3vtw.mongodb.net/?retryWrites=true&w=majority&appName=scavenger-hunt', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('Connected to MongoDB'));

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
app.get('/scan', scanLimiter, async (req, res) => {
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
      <form action="/register" method="post">
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
app.post('/register', async (req, res) => {
  const { registrationNumber, code } = req.body;

  // Validate registration number (basic example: alphanumeric)
  if (!registrationNumber.match(/^[A-Z0-9]+$/)) {
    return res.status(400).send('<h1>Invalid Registration Number</h1><p>Use only letters and numbers.</p>');
  }

  // Set cookie and log scan
  res.cookie('registrationNumber', registrationNumber, { httpOnly: true, secure: true });
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

// Start server
app.listen(3000, () => console.log('Server running on port 3000'));