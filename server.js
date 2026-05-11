require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Users are loaded from users.json — edit that file to add/remove users
const USERS = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8'));

// MongoDB connection (used only for proposals)
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected!"))
  .catch(err => console.log("❌ MongoDB connection error:", err));

// Proposal Schema
const proposalSchema = new mongoose.Schema({
    clientName:  { type: String, required: true },
    projectType: { type: String },
    location:    { type: String },
    area:        { type: Number },
    totalFee:    { type: Number },
    status:      { type: String, default: 'Sent' },
    notes:       { type: String, default: '' },
    createdBy:   { type: String, default: 'admin' },
    fullData:    { type: String },
    createdAt:   { type: Date, default: Date.now }
});
const Proposal = mongoose.model('Proposal', proposalSchema);

// --- LOGIN --- (verified against users.json, no MongoDB needed)
app.post('/api/login', (req, res) => {
    const username = req.body.username?.trim();
    const password = req.body.password?.trim();

    const user = USERS.find(u => u.username === username && u.password === password);
    if (user) {
        res.status(200).json({ success: true, data: { username: user.username, role: user.role, name: user.name } });
    } else {
        res.status(401).json({ success: false, message: "Invalid username or password" });
    }
});

// --- EMAIL WITH PDF ATTACHMENT ---
app.post('/api/send-email', async (req, res) => {
    try {
        const { to, clientName, location, area, netFee, date, advisor, pdfBase64, filename } = req.body;

        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            tls: { rejectUnauthorized: false },
            auth: {
                user: process.env.GMAIL_USER?.trim(),
                pass: process.env.GMAIL_PASS?.trim(),
            }
        });

        const mailOptions = {
            from: `"Essentia Sales Department" <${process.env.GMAIL_USER?.trim()}>`,
            to,
            subject: `Essentia Fee Proposal — ${clientName} — ${location}`,
            html: `
                <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2A2320;">
                    <div style="border-bottom:2px solid #8C7355;padding-bottom:16px;margin-bottom:24px;">
                        <h2 style="font-weight:300;font-size:22px;margin:0;color:#1C1714;">Essentia Sales Department</h2>
                        <p style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#8C7355;margin:4px 0 0;">Design Fee Proposal</p>
                    </div>
                    <p style="font-size:15px;line-height:1.8;">Dear <strong>${clientName}</strong>,</p>
                    <p style="font-size:14px;line-height:1.8;color:#4A4840;">
                        Please find attached your Design Fee Proposal from Essentia Sales Department.
                    </p>
                    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px;">
                        <tr style="border-bottom:1px solid #DDD8D2;"><td style="padding:8px 0;color:#6A6460;">Project Location</td><td style="padding:8px 0;font-weight:500;">${location}</td></tr>
                        <tr style="border-bottom:1px solid #DDD8D2;"><td style="padding:8px 0;color:#6A6460;">Area</td><td style="padding:8px 0;font-weight:500;">${area}</td></tr>
                        <tr style="border-bottom:1px solid #DDD8D2;"><td style="padding:8px 0;color:#6A6460;">Net Design Fee</td><td style="padding:8px 0;font-size:16px;color:#8C7355;font-weight:600;">${netFee}</td></tr>
                        <tr style="border-bottom:1px solid #DDD8D2;"><td style="padding:8px 0;color:#6A6460;">Date</td><td style="padding:8px 0;">${date}</td></tr>
                        ${advisor ? `<tr><td style="padding:8px 0;color:#6A6460;">Your Advisor</td><td style="padding:8px 0;font-weight:500;">${advisor}</td></tr>` : ''}
                    </table>
                    <p style="font-size:13px;line-height:1.8;color:#4A4840;">
                        The detailed proposal PDF is attached to this email. Please review it at your convenience.
                    </p>
                    <p style="font-size:13px;margin-top:24px;">Warm regards,<br/><strong>The Essentia Team</strong></p>
                    <div style="border-top:1px solid #DDD8D2;margin-top:24px;padding-top:12px;font-size:10px;color:#9A9490;letter-spacing:0.1em;text-transform:uppercase;">
                        Essentia Sales Department · Confidential
                    </div>
                </div>
            `,
            attachments: pdfBase64 ? [{
                filename: filename || 'Essentia_Proposal.pdf',
                content: pdfBase64,
                encoding: 'base64',
                contentType: 'application/pdf'
            }] : []
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ success: true, message: 'Email sent!' });
    } catch (error) {
        console.error('❌ Email Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST - Proposal save
app.post('/api/proposals', async (req, res) => {
    try {
        const { clientName, projectType, location, area, totalFee, fullData, createdBy } = req.body;
        const newProposal = new Proposal({
            clientName,
            projectType,
            location,
            area,
            totalFee,
            createdBy: createdBy || 'admin',
            fullData: fullData ? JSON.stringify(fullData) : null
        });
        await newProposal.save();
        res.status(201).json({ message: "Proposal saved successfully!", data: newProposal });
    } catch (error) {
        console.error("❌ Save Error:", error);
        res.status(500).json({ error: error.message || "Failed to save proposal" });
    }
});

// GET - Proposals filtered by role (admin sees all, sales sees own only)
app.get('/api/proposals', async (req, res) => {
    try {
        const { role, username } = req.query;
        const filter = (role === 'admin') ? {} : { createdBy: username };
        const proposals = await Proposal.find(filter).sort({ createdAt: -1 });

        const formattedProposals = proposals.map(p => {
            let parsedData = null;
            if (p.fullData) {
                try { parsedData = JSON.parse(p.fullData); } catch(e) {}
            }
            return {
                _id: p._id,
                clientName: p.clientName,
                projectType: p.projectType,
                location: p.location,
                area: p.area,
                totalFee: p.totalFee,
                status: p.status,
                notes: p.notes || "",
                createdAt: p.createdAt,
                fullData: parsedData
            };
        });

        res.status(200).json(formattedProposals);
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        res.status(500).json({ error: "Failed to fetch proposals" });
    }
});

// PUT - Status/notes update
app.put('/api/proposals/:id', async (req, res) => {
    try {
        const { status, notes } = req.body;
        const updatedProposal = await Proposal.findByIdAndUpdate(
            req.params.id,
            { status, notes },
            { new: true }
        );
        res.status(200).json(updatedProposal);
    } catch (error) {
        console.error("❌ Update Error:", error);
        res.status(500).json({ error: "Failed to update proposal" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
