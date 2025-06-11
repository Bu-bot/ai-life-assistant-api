// backend/services/aiProcessor.js
const axios = require('axios');

class AIProcessor {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.apiUrl = 'https://api.openai.com/v1/chat/completions';
        
        // Simplified settings without heavy filtering
        this.MAX_RECORDINGS_FOR_CONTEXT = 50; // Use more recordings now
        this.MAX_CONTEXT_LENGTH = 8000; // Increased context limit
    }

    async extractEntities(text) {
        if (!this.openaiApiKey) {
            console.warn('OpenAI API key not found for entity extraction');
            return {};
        }

        try {
            const prompt = `Extract structured information from this personal recording:
"${text}"

Return a JSON object with these categories (only include if present):
- people: names mentioned
- tasks: action items or things to do
- events: meetings, appointments, social events
- dates: specific dates or time references
- times: specific times
- locations: addresses or place names
- items: shopping lists, objects mentioned
- topics: main subjects discussed

Example: {"people": ["John"], "tasks": ["call dentist"], "dates": ["tomorrow"]}

Return only valid JSON, no other text.`;

            const response = await axios.post(this.apiUrl, {
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that extracts structured information from text. Always return valid JSON only.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 300,
                temperature: 0.1
            }, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const result = response.data.choices[0].message.content.trim();
            return JSON.parse(result);
        } catch (error) {
            console.error('Entity extraction error:', error.message);
            return {};
        }
    }

    // Simplified context preparation - no complex filtering
    prepareContext(recordings) {
        if (!recordings || recordings.length === 0) return '';

        // Take the most recent recordings up to our limit
        const recentRecordings = recordings
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, this.MAX_RECORDINGS_FOR_CONTEXT);

        let context = '';
        let usedRecordings = 0;
        
        for (const recording of recentRecordings) {
            const recordingText = `[${new Date(recording.timestamp).toLocaleDateString()}] ${recording.text}\n`;
            
            // Check if adding this recording would exceed our context limit
            if (context.length + recordingText.length > this.MAX_CONTEXT_LENGTH) {
                break;
            }
            
            context += recordingText;
            usedRecordings++;
        }
        
        console.log(`Using ${usedRecordings} recordings (${context.length} characters) for context`);
        return context;
    }

    async generateResponse(question, recordings) {
        if (!this.openaiApiKey) {
            return "I need an OpenAI API key to provide intelligent responses. Currently running without AI capabilities.";
        }

        if (!recordings || recordings.length === 0) {
            return "I don't have any recordings to search through yet. Try recording something first!";
        }

        try {
            // Use ALL recordings (no filtering) up to our limits
            const context = this.prepareContext(recordings);
            
            if (!context) {
                return `I have ${recordings.length} recordings but they're too long to process efficiently. Try asking about more recent topics.`;
            }
            
            // Get current date context
            const now = new Date();
            const todayDate = now.toLocaleDateString();
            const todayDay = now.toLocaleDateString('en-US', { weekday: 'long' });
            
            const prompt = `You are a personal AI assistant. Answer the user's question based ONLY on their recorded information below.

Current Context:
- Today is ${todayDay}, ${todayDate}
- When user asks about "today", they mean ${todayDay}
- When user asks about "this week", consider the current week context

Personal recordings (most recent shown):
${context}

User question: ${question}

Instructions:
- Provide a helpful, specific answer based only on the recordings above
- Use the current date context to interpret time-related questions
- If user asks about "today's lunch" and you see lunch plans for "${todayDay}", connect them
- If the recordings don't contain enough information to fully answer the question, say so
- Be concise but thorough
- Reference specific recordings when relevant (by date if helpful)
- Do not make up information not present in the recordings
- Note: I'm searching through ${recordings.length} total recordings to find your answer`;

            const response = await axios.post(this.apiUrl, {
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: 'You are a helpful personal assistant that answers questions based strictly on the user\'s recorded information. Never make up information.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 500,
                temperature: 0.3
            }, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const aiResponse = response.data.choices[0].message.content.trim();
            
            // Add simple context info
            const contextInfo = `\n\n💡 *Searched ${recordings.length} recordings for your answer.*`;
            
            return aiResponse + contextInfo;

        } catch (error) {
            console.error('Response generation error:', error.message);
            
            if (error.response?.status === 429) {
                return "I'm currently experiencing high demand. Please try again in a moment.";
            } else if (error.response?.status === 401) {
                return "There's an issue with my API authentication. Please check the configuration.";
            } else {
                return "I encountered an error while processing your question. Please try again.";
            }
        }
    }

    // Simple cost estimation
    estimateTokenUsage(question, recordings) {
        const context = this.prepareContext(recordings);
        
        // Rough token estimation (1 token ≈ 4 characters)
        const estimatedTokens = Math.ceil((question.length + context.length + 200) / 4);
        const estimatedCost = estimatedTokens * 0.0000015; // GPT-3.5-turbo pricing
        
        return {
            totalRecordings: recordings.length,
            usedRecordings: Math.min(recordings.length, this.MAX_RECORDINGS_FOR_CONTEXT),
            estimatedTokens,
            estimatedCostUSD: estimatedCost.toFixed(6)
        };
    }
}

module.exports = new AIProcessor();