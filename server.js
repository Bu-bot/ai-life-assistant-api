const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const speechToText = require('./services/speechToText');
const aiProcessor = require('./services/aiProcessor');
const database = require('./services/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `recording-${Date.now()}.wav`);
    }
});

const upload = multer({ storage });

// Routes
app.get('/api/recordings', async (req, res) => {
    try {
        const recordings = await database.getAllRecordings();
        res.json(recordings);
    } catch (error) {
        console.error('Error fetching recordings:', error);
        res.status(500).json({ error: 'Failed to fetch recordings' });
    }
});

app.post('/api/recordings', upload.single('audio'), async (req, res) => {
    try {
        let transcription;
        
        if (req.file) {
            // Process actual audio file
            transcription = await speechToText.transcribeAudio(req.file.path);
            
            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
        } else if (req.body.text) {
            // Handle direct text input (for testing)
            transcription = req.body.text;
        } else {
            return res.status(400).json({ error: 'No audio file or text provided' });
        }

        if (!transcription || transcription.trim() === '') {
            return res.status(400).json({ error: 'Failed to transcribe audio - no text detected' });
        }

        // Extract entities and context using AI
        const entities = await aiProcessor.extractEntities(transcription);
        
        // Save to database
        const newRecording = await database.saveRecording(transcription, entities);
        
        res.json(newRecording);
    } catch (error) {
        console.error('Error processing recording:', error);
        res.status(500).json({ error: 'Failed to process recording. Please try again.' });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { question } = req.body;
        
        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        // Get all recordings from database
        const recordings = await database.getAllRecordings();

        if (recordings.length === 0) {
            return res.json({ 
                response: "I don't have any recordings to search through yet. Try recording something first, then ask me questions about it!" 
            });
        }

        // Generate response based on recordings
        const response = await aiProcessor.generateResponse(question, recordings);
        
        res.json({ response });
    } catch (error) {
        console.error('Error generating response:', error);
        res.status(500).json({ error: 'Sorry, I had trouble understanding your question. Please try again.' });
    }
});

// Analytics endpoint for future dashboard
app.get('/api/analytics', async (req, res) => {
    try {
        const timeframe = req.query.timeframe || '30 days';
        const analytics = await database.getAnalytics(timeframe);
        res.json(analytics);
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Search endpoint
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Search query is required' });
        }
        
        const results = await database.searchRecordings(q);
        res.json(results);
    } catch (error) {
        console.error('Error searching recordings:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Health check with database status
app.get('/api/health', async (req, res) => {
    try {
        const recordings = await database.getAllRecordings();
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            database: 'connected',
            recordings_count: recordings.length
        });
    } catch (error) {
        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            database: 'error',
            error: error.message
        });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await database.close();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log('Database connection will be tested on first request');
});