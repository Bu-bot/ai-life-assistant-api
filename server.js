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
        
        // Save to database (this now handles project detection automatically)
        const newRecording = await database.saveRecording(transcription, entities);
        
        // Check for potential task completions
        try {
            const taskCompletion = await database.detectTaskCompletion(transcription, newRecording.id);
            if (taskCompletion.hasCompletion) {
                newRecording.taskCompletionDetected = taskCompletion;
                console.log(`🎯 Task completion detected in recording ${newRecording.id}`);
            }
        } catch (error) {
            console.error('Error checking task completion:', error);
            // Don't fail the whole request if task detection fails
        }
        
        res.json(newRecording);
    } catch (error) {
        console.error('Error processing recording:', error);
        res.status(500).json({ error: 'Failed to process recording. Please try again.' });
    }
});

// Delete recording endpoint
app.delete('/api/recordings/:id', async (req, res) => {
    try {
        const recordingId = parseInt(req.params.id);
        
        if (!recordingId || isNaN(recordingId)) {
            return res.status(400).json({ error: 'Invalid recording ID' });
        }
        
        // Delete from database
        const deletedRecording = await database.deleteRecording(recordingId);
        
        if (deletedRecording) {
            res.json({ 
                message: 'Recording deleted successfully',
                deletedRecording: deletedRecording 
            });
        } else {
            res.status(404).json({ error: 'Recording not found' });
        }
    } catch (error) {
        console.error('Error deleting recording:', error);
        res.status(500).json({ error: 'Failed to delete recording' });
    }
});

// Task endpoints
app.get('/api/tasks/pending', async (req, res) => {
    try {
        const pendingTasks = await database.getPendingTasks();
        res.json(pendingTasks);
    } catch (error) {
        console.error('Error fetching pending tasks:', error);
        res.status(500).json({ error: 'Failed to fetch pending tasks' });
    }
});

app.post('/api/tasks/:id/complete', async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const { completedByRecordingId } = req.body;
        
        if (!taskId || isNaN(taskId)) {
            return res.status(400).json({ error: 'Invalid task ID' });
        }
        
        const completedTask = await database.completeTask(taskId, completedByRecordingId);
        
        if (completedTask) {
            res.json({ 
                message: 'Task marked as completed',
                task: completedTask 
            });
        } else {
            res.status(404).json({ error: 'Task not found or already completed' });
        }
    } catch (error) {
        console.error('Error completing task:', error);
        res.status(500).json({ error: 'Failed to complete task' });
    }
});

// Projects endpoints
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await database.getAllProjects();
        res.json(projects);
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const { name, description, color } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Project name is required' });
        }
        
        const newProject = await database.createProject(name, description, color);
        res.status(201).json(newProject);
    } catch (error) {
        if (error.message === 'Project name already exists') {
            res.status(409).json({ error: 'Project name already exists' });
        } else {
            console.error('Error creating project:', error);
            res.status(500).json({ error: 'Failed to create project' });
        }
    }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        
        if (!projectId || isNaN(projectId)) {
            return res.status(400).json({ error: 'Invalid project ID' });
        }
        
        const result = await database.deleteProject(projectId);
        res.json({ 
            message: 'Project deleted successfully',
            project: result.project,
            movedRecordings: result.movedRecordings
        });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

app.get('/api/projects/:id/recordings', async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        
        if (!projectId || isNaN(projectId)) {
            return res.status(400).json({ error: 'Invalid project ID' });
        }
        
        const recordings = await database.getProjectRecordings(projectId);
        res.json(recordings);
    } catch (error) {
        console.error('Error fetching project recordings:', error);
        res.status(500).json({ error: 'Failed to fetch project recordings' });
    }
});

// Chat endpoint
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

// Analytics endpoint
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

// Health check
app.get('/api/health', async (req, res) => {
    try {
        const recordings = await database.getAllRecordings();
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            database: 'connected',
            recordings_count: recordings.length,
            version: '3.0.0'
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