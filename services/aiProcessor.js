// backend/services/aiProcessor.js
const axios = require('axios');

class AIProcessor {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.apiUrl = 'https://api.openai.com/v1/chat/completions';
        
        // Cost control settings
        this.MAX_RECORDINGS_PER_QUERY = 15; // Maximum recordings to send per question
        this.MAX_CONTEXT_LENGTH = 3000; // Maximum characters of context
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

    // Smart context filtering to reduce costs
    filterRelevantRecordings(question, recordings) {
        if (!recordings || recordings.length === 0) return [];

        const questionLower = question.toLowerCase();
        const questionWords = questionLower.split(/\s+/).filter(word => word.length > 2);
        
        // Score recordings by relevance
        const scoredRecordings = recordings.map(recording => {
            let score = 0;
            const recordingText = recording.text.toLowerCase();
            const recordingAge = Date.now() - new Date(recording.timestamp).getTime();
            const daysOld = recordingAge / (1000 * 60 * 60 * 24);
            
            // Score based on keyword matches
            questionWords.forEach(word => {
                if (recordingText.includes(word)) {
                    score += 10;
                }
            });
            
            // Score based on entity matches
            if (recording.entities) {
                Object.values(recording.entities).forEach(entityArray => {
                    if (Array.isArray(entityArray)) {
                        entityArray.forEach(entity => {
                            if (questionLower.includes(entity.toLowerCase())) {
                                score += 15; // Higher weight for entity matches
                            }
                        });
                    }
                });
            }
            
            // Boost recent recordings slightly
            if (daysOld < 7) score += 2;
            if (daysOld < 1) score += 3;
            
            return { ...recording, relevanceScore: score };
        });
        
        // Sort by relevance and take top recordings
        const relevantRecordings = scoredRecordings
            .filter(r => r.relevanceScore > 0) // Only include recordings with some relevance
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, this.MAX_RECORDINGS_PER_QUERY);
        
        // If no relevant recordings found, include recent ones
        if (relevantRecordings.length === 0) {
            return recordings
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, Math.min(5, recordings.length));
        }
        
        console.log(`Filtered ${recordings.length} recordings down to ${relevantRecordings.length} relevant ones`);
        return relevantRecordings;
    }

    // Trim context to stay within character limits
    trimContext(recordings) {
        let context = '';
        let usedRecordings = 0;
        
        for (const recording of recordings) {
            const recordingText = `[${new Date(recording.timestamp).toLocaleDateString()}] ${recording.text}\n`;
            
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
            // Step 1: Filter for relevant recordings only
            const relevantRecordings = this.filterRelevantRecordings(question, recordings);
            
            if (relevantRecordings.length === 0) {
                return `I searched through your ${recordings.length} recordings but couldn't find anything relevant to "${question}". Try asking about topics you've actually recorded, or record something new first!`;
            }
            
            // Step 2: Trim context to stay within limits
            const context = this.trimContext(relevantRecordings);
            
            const prompt = `You are a personal AI assistant. Answer the user's question based ONLY on their recorded information below.

Personal recordings (most relevant shown):
${context}

User question: ${question}

Instructions:
- Provide a helpful, specific answer based only on the recordings above
- If the recordings don't contain enough information to fully answer the question, say so
- Be concise but thorough
- Reference specific recordings when relevant (by date if helpful)
- Do not make up information not present in the recordings
- Note: I've only shown you the most relevant recordings to keep costs down`;

            const response = await axios.post(this.apiUrl, {
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: 'You are a helpful personal assistant that answers questions based strictly on the user\'s recorded information. Never make up information.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 400,
                temperature: 0.3
            }, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const aiResponse = response.data.choices[0].message.content.trim();
            
            // Add context info for transparency
            const contextInfo = relevantRecordings.length < recordings.length 
                ? `\n\n💡 *Searched ${recordings.length} recordings, showing answer based on ${relevantRecordings.length} most relevant ones.*`
                : '';
            
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

    // Get cost estimation for transparency
    estimateTokenUsage(question, recordings) {
        const relevantRecordings = this.filterRelevantRecordings(question, recordings);
        const context = this.trimContext(relevantRecordings);
        
        // Rough token estimation (1 token ≈ 4 characters)
        const estimatedTokens = Math.ceil((question.length + context.length + 200) / 4);
        const estimatedCost = estimatedTokens * 0.0000015; // GPT-3.5-turbo pricing
        
        return {
            totalRecordings: recordings.length,
            relevantRecordings: relevantRecordings.length,
            estimatedTokens,
            estimatedCostUSD: estimatedCost.toFixed(6)
        };
    }
}

module.exports = new AIProcessor();