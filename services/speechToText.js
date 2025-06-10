// backend/services/speechToText.js
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

class SpeechToTextService {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
    }

    async transcribeAudio(audioFilePath) {
        if (!this.openaiApiKey) {
            throw new Error('OpenAI API key not configured. Speech-to-text unavailable.');
        }

        if (!fs.existsSync(audioFilePath)) {
            throw new Error('Audio file not found');
        }

        try {
            // Check file size - Whisper has a 25MB limit
            const stats = fs.statSync(audioFilePath);
            const fileSizeInMB = stats.size / (1024 * 1024);
            
            if (fileSizeInMB > 25) {
                throw new Error('Audio file too large (max 25MB)');
            }

            if (stats.size === 0) {
                throw new Error('Audio file is empty');
            }

            console.log(`Processing audio file: ${audioFilePath}, size: ${(stats.size / 1024).toFixed(2)}KB`);

            const formData = new FormData();
            
            // Create read stream with proper options
            const audioStream = fs.createReadStream(audioFilePath);
            
            // Determine file extension and set appropriate name
            const fileExtension = audioFilePath.split('.').pop().toLowerCase();
            let filename = `audio.${fileExtension}`;
            
            // Map common mobile formats
            if (fileExtension === 'webm') {
                filename = 'audio.webm';
            } else if (fileExtension === 'mp4' || fileExtension === 'm4a') {
                filename = 'audio.mp4';
            } else if (fileExtension === 'wav') {
                filename = 'audio.wav';
            } else {
                // Default to wav if unknown
                filename = 'audio.wav';
            }

            formData.append('file', audioStream, {
                filename: filename,
                contentType: this.getContentType(fileExtension)
            });
            formData.append('model', 'whisper-1');
            formData.append('language', 'en');
            
            // Enhanced options for better transcription
            formData.append('response_format', 'verbose_json');
            formData.append('temperature', '0.2'); // Lower temperature for more accurate transcription

            console.log(`Sending to Whisper API: ${filename}, content-type: ${this.getContentType(fileExtension)}`);

            const response = await axios.post(
                'https://api.openai.com/v1/audio/transcriptions',
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                    },
                    timeout: 30000, // 30 second timeout
                    maxContentLength: 26214400, // 25MB in bytes
                    maxBodyLength: 26214400
                }
            );

            // Handle both verbose and simple response formats
            let transcription;
            if (response.data.text) {
                transcription = response.data.text.trim();
            } else if (typeof response.data === 'string') {
                transcription = response.data.trim();
            } else {
                throw new Error('Unexpected response format from Whisper API');
            }
            
            console.log(`Whisper transcription result: "${transcription}"`);
            
            // Enhanced validation
            if (!transcription || transcription.length === 0) {
                throw new Error('No speech detected in audio - recording may be too quiet or empty');
            }

            // Check for common Whisper artifacts that indicate poor audio
            const lowQualityIndicators = [
                transcription.length < 3,
                /^(you|uh|um|hmm)$/i.test(transcription),
                /^[^a-zA-Z0-9\s]+$/.test(transcription), // Only special characters
                transcription === transcription.toLowerCase() && transcription.length < 10 // All lowercase and very short
            ];

            if (lowQualityIndicators.some(indicator => indicator)) {
                console.warn(`Low quality transcription detected: "${transcription}"`);
                throw new Error('Audio quality too low for transcription. Please speak more clearly and closer to the microphone.');
            }

            return transcription;

        } catch (error) {
            console.error('Transcription error details:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                audioPath: audioFilePath
            });

            if (error.response?.status === 429) {
                throw new Error('Speech-to-text service is busy. Please try again in a moment.');
            } else if (error.response?.status === 401) {
                throw new Error('Invalid API key for speech-to-text service.');
            } else if (error.response?.status === 413) {
                throw new Error('Audio file too large. Please record shorter clips.');
            } else if (error.response?.status === 400) {
                const errorMsg = error.response?.data?.error?.message || 'Invalid audio format';
                throw new Error(`Audio format error: ${errorMsg}. Try recording again.`);
            } else if (error.message.includes('No speech detected') || error.message.includes('Audio quality too low')) {
                throw error; // Pass through our custom messages
            } else if (error.code === 'ECONNABORTED') {
                throw new Error('Transcription timed out. Please try a shorter recording.');
            } else {
                throw new Error(`Transcription failed: ${error.message}. Please try recording again.`);
            }
        }
    }

    getContentType(fileExtension) {
        const contentTypes = {
            'wav': 'audio/wav',
            'webm': 'audio/webm',
            'mp4': 'audio/mp4',
            'm4a': 'audio/mp4',
            'ogg': 'audio/ogg',
            'mp3': 'audio/mpeg',
            'flac': 'audio/flac'
        };
        
        return contentTypes[fileExtension.toLowerCase()] || 'audio/wav';
    }

    // Test method to validate service
    async testService() {
        if (!this.openaiApiKey) {
            return { status: 'error', message: 'OpenAI API key not configured' };
        }
        
        try {
            // Try a simple API call to validate the key
            await axios.get('https://api.openai.com/v1/models', {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                },
                timeout: 5000
            });
            
            return { status: 'ok', message: 'Speech-to-text service is ready' };
        } catch (error) {
            return { 
                status: 'error', 
                message: `Service test failed: ${error.response?.status || error.message}` 
            };
        }
    }
}

module.exports = new SpeechToTextService();