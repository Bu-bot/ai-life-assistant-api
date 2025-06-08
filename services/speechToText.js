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
            const formData = new FormData();
            formData.append('file', fs.createReadStream(audioFilePath));
            formData.append('model', 'whisper-1');
            formData.append('language', 'en');

            const response = await axios.post(
                'https://api.openai.com/v1/audio/transcriptions',
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                    },
                }
            );

            const transcription = response.data.text.trim();
            
            if (!transcription) {
                throw new Error('No speech detected in audio');
            }

            return transcription;
        } catch (error) {
            if (error.response?.status === 429) {
                throw new Error('Speech-to-text service is busy. Please try again in a moment.');
            } else if (error.response?.status === 401) {
                throw new Error('Invalid API key for speech-to-text service.');
            } else if (error.message.includes('No speech detected')) {
                throw new Error('No speech detected in the recording. Please try speaking more clearly.');
            } else {
                console.error('Transcription error:', error.message);
                throw new Error('Failed to transcribe audio. Please try again.');
            }
        }
    }
}

module.exports = new SpeechToTextService();