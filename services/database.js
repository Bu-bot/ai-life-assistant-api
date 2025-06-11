// backend/services/database.js
const { Pool } = require('pg');

class DatabaseService {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        
        // Test connection on startup
        this.testConnection();
    }

    async testConnection() {
        try {
            const client = await this.pool.connect();
            console.log('✅ Database connected successfully');
            client.release();
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
        }
    }

    // Save a new recording with extracted entities
    async saveRecording(text, entities = {}) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            // Calculate word count
            const wordCount = text.trim().split(/\s+/).length;

            // Insert main recording
            const recordingResult = await client.query(
                `INSERT INTO recordings (text, word_count, timestamp) 
                 VALUES ($1, $2, NOW()) 
                 RETURNING id, timestamp`,
                [text, wordCount]
            );

            const recordingId = recordingResult.rows[0].id;
            const timestamp = recordingResult.rows[0].timestamp;

            // Insert extracted entities into separate tables
            await this.insertEntities(client, recordingId, entities);

            await client.query('COMMIT');

            console.log(`📝 Recording saved with ID: ${recordingId}`);
            
            return {
                id: recordingId,
                timestamp: timestamp,
                text: text,
                entities: entities,
                word_count: wordCount
            };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error saving recording:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Delete a recording and all its related entities
    async deleteRecording(recordingId) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Delete related entities first (foreign key constraints)
            await client.query('DELETE FROM people WHERE recording_id = $1', [recordingId]);
            await client.query('DELETE FROM tasks WHERE recording_id = $1', [recordingId]);
            await client.query('DELETE FROM events WHERE recording_id = $1', [recordingId]);
            await client.query('DELETE FROM topics WHERE recording_id = $1', [recordingId]);
            await client.query('DELETE FROM locations WHERE recording_id = $1', [recordingId]);
            await client.query('DELETE FROM items WHERE recording_id = $1', [recordingId]);
            
            // Delete the main recording
            const result = await client.query(
                'DELETE FROM recordings WHERE id = $1 RETURNING *', 
                [recordingId]
            );
            
            await client.query('COMMIT');
            
            if (result.rows.length > 0) {
                console.log(`🗑️ Recording ${recordingId} deleted successfully`);
                return result.rows[0];
            } else {
                console.log(`❌ Recording ${recordingId} not found`);
                return null;
            }
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error deleting recording:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Insert entities into their respective tables
    async insertEntities(client, recordingId, entities) {
        // Insert people
        if (entities.people && entities.people.length > 0) {
            for (const person of entities.people) {
                await client.query(
                    'INSERT INTO people (recording_id, name) VALUES ($1, $2)',
                    [recordingId, person]
                );
            }
        }

        // Insert tasks
        if (entities.tasks && entities.tasks.length > 0) {
            for (const task of entities.tasks) {
                await client.query(
                    'INSERT INTO tasks (recording_id, task_description) VALUES ($1, $2)',
                    [recordingId, task]
                );
            }
        }

        // Insert events
        if (entities.events && entities.events.length > 0) {
            for (const event of entities.events) {
                await client.query(
                    'INSERT INTO events (recording_id, event_name) VALUES ($1, $2)',
                    [recordingId, event]
                );
            }
        }

        // Insert topics
        if (entities.topics && entities.topics.length > 0) {
            for (const topic of entities.topics) {
                await client.query(
                    'INSERT INTO topics (recording_id, topic) VALUES ($1, $2)',
                    [recordingId, topic]
                );
            }
        }

        // Insert locations
        if (entities.locations && entities.locations.length > 0) {
            for (const location of entities.locations) {
                await client.query(
                    'INSERT INTO locations (recording_id, location_name) VALUES ($1, $2)',
                    [recordingId, location]
                );
            }
        }

        // Insert items
        if (entities.items && entities.items.length > 0) {
            for (const item of entities.items) {
                await client.query(
                    'INSERT INTO items (recording_id, item_name) VALUES ($1, $2)',
                    [recordingId, item]
                );
            }
        }
    }

    // Get all recordings with their entities (for AI context)
    async getAllRecordings() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    r.id,
                    r.timestamp,
                    r.text,
                    r.word_count,
                    
                    -- Aggregate people as JSON array
                    COALESCE(
                        JSON_AGG(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL), 
                        '[]'::json
                    ) as people,
                    
                    -- Aggregate tasks as JSON array
                    COALESCE(
                        JSON_AGG(DISTINCT t.task_description) FILTER (WHERE t.task_description IS NOT NULL), 
                        '[]'::json
                    ) as tasks,
                    
                    -- Aggregate events as JSON array
                    COALESCE(
                        JSON_AGG(DISTINCT e.event_name) FILTER (WHERE e.event_name IS NOT NULL), 
                        '[]'::json
                    ) as events,
                    
                    -- Aggregate topics as JSON array
                    COALESCE(
                        JSON_AGG(DISTINCT tp.topic) FILTER (WHERE tp.topic IS NOT NULL), 
                        '[]'::json
                    ) as topics,
                    
                    -- Aggregate locations as JSON array
                    COALESCE(
                        JSON_AGG(DISTINCT l.location_name) FILTER (WHERE l.location_name IS NOT NULL), 
                        '[]'::json
                    ) as locations,
                    
                    -- Aggregate items as JSON array
                    COALESCE(
                        JSON_AGG(DISTINCT i.item_name) FILTER (WHERE i.item_name IS NOT NULL), 
                        '[]'::json
                    ) as items
                    
                FROM recordings r
                LEFT JOIN people p ON r.id = p.recording_id
                LEFT JOIN tasks t ON r.id = t.recording_id
                LEFT JOIN events e ON r.id = e.recording_id
                LEFT JOIN topics tp ON r.id = tp.recording_id
                LEFT JOIN locations l ON r.id = l.recording_id
                LEFT JOIN items i ON r.id = i.recording_id
                
                GROUP BY r.id, r.timestamp, r.text, r.word_count
                ORDER BY r.timestamp DESC
            `);

            // Transform the result to match the expected format
            return result.rows.map(row => ({
                id: row.id,
                timestamp: row.timestamp,
                text: row.text,
                word_count: row.word_count,
                entities: {
                    people: row.people || [],
                    tasks: row.tasks || [],
                    events: row.events || [],
                    topics: row.topics || [],
                    locations: row.locations || [],
                    items: row.items || []
                }
            }));

        } catch (error) {
            console.error('Error fetching recordings:', error);
            throw error;
        }
    }

    // Analytics queries for future dashboard
    async getAnalytics(timeframe = '30 days') {
        try {
            const result = await this.pool.query(`
                SELECT 
                    COUNT(DISTINCT r.id) as total_recordings,
                    COUNT(DISTINCT p.name) as unique_people,
                    COUNT(t.id) as total_tasks,
                    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks,
                    AVG(r.word_count) as avg_words_per_recording
                FROM recordings r
                LEFT JOIN people p ON r.id = p.recording_id
                LEFT JOIN tasks t ON r.id = t.recording_id
                WHERE r.timestamp >= NOW() - INTERVAL '${timeframe}'
            `);

            return result.rows[0];
        } catch (error) {
            console.error('Error fetching analytics:', error);
            throw error;
        }
    }

    // Search recordings by text content
    async searchRecordings(searchTerm) {
        try {
            const result = await this.pool.query(`
                SELECT id, timestamp, text, word_count
                FROM recordings 
                WHERE text ILIKE $1
                ORDER BY timestamp DESC
                LIMIT 50
            `, [`%${searchTerm}%`]);

            return result.rows;
        } catch (error) {
            console.error('Error searching recordings:', error);
            throw error;
        }
    }

    // Add these methods to your existing database.js DatabaseService class

    // Get pending tasks only
    async getPendingTasks() {
        try {
            const result = await this.pool.query(`
                SELECT t.*, r.timestamp as recorded_at, r.text as recording_text
                FROM tasks t
                JOIN recordings r ON t.recording_id = r.id
                WHERE t.status = 'pending'
                ORDER BY r.timestamp DESC
            `);

            return result.rows;
        } catch (error) {
            console.error('Error fetching pending tasks:', error);
            throw error;
        }
    }

    // Mark task as completed
    async completeTask(taskId, completedByRecordingId = null) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const result = await client.query(
                `UPDATE tasks 
                 SET status = 'completed', 
                     completed_at = NOW(),
                     completed_by_recording_id = $2
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [taskId, completedByRecordingId]
            );
            
            await client.query('COMMIT');
            
            if (result.rows.length > 0) {
                console.log(`✅ Task ${taskId} marked as completed`);
                return result.rows[0];
            } else {
                console.log(`❌ Task ${taskId} not found or already completed`);
                return null;
            }
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error completing task:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Find potential task completions in new recording
    async findPotentialTaskCompletions(recordingText, recordingId) {
        try {
            // Get all pending tasks
            const pendingTasks = await this.getPendingTasks();
            
            if (pendingTasks.length === 0) {
                return [];
            }
            
            const potentialMatches = [];
            const recordingLower = recordingText.toLowerCase();
            
            // Look for completion keywords + task similarity
            const completionKeywords = [
                'done', 'finished', 'completed', 'called', 'talked to', 
                'met with', 'spoke to', 'emailed', 'sent', 'bought',
                'picked up', 'dropped off', 'scheduled', 'booked'
            ];
            
            // Check if recording contains completion keywords
            const hasCompletionKeyword = completionKeywords.some(keyword => 
                recordingLower.includes(keyword)
            );
            
            if (hasCompletionKeyword) {
                // Find tasks that might be referenced in this recording
                for (const task of pendingTasks) {
                    const taskDescription = task.task_description.toLowerCase();
                    const taskWords = taskDescription.split(/\s+/).filter(word => word.length > 2);
                    
                    // Check for word overlap between recording and task
                    const matchingWords = taskWords.filter(word => 
                        recordingLower.includes(word)
                    );
                    
                    // If significant overlap, consider it a potential match
                    if (matchingWords.length >= Math.min(2, taskWords.length * 0.5)) {
                        potentialMatches.push({
                            taskId: task.id,
                            taskDescription: task.task_description,
                            recordingId: recordingId,
                            matchingWords: matchingWords,
                            confidence: matchingWords.length / taskWords.length
                        });
                    }
                }
            }
            
            // Sort by confidence (highest first)
            return potentialMatches.sort((a, b) => b.confidence - a.confidence);
            
        } catch (error) {
            console.error('Error finding task completions:', error);
            return [];
        }
    }

    // Create task completion suggestions table if needed
    async createTaskSuggestionsTable() {
        try {
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS task_completion_suggestions (
                    id SERIAL PRIMARY KEY,
                    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                    recording_id INTEGER REFERENCES recordings(id) ON DELETE CASCADE,
                    confidence DECIMAL(3,2),
                    matching_words TEXT[],
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT NOW(),
                    responded_at TIMESTAMP NULL
                )
            `);
            console.log('✅ Task completion suggestions table ready');
        } catch (error) {
            console.error('Error creating task suggestions table:', error);
            throw error;
        }
    }

    // Get pending tasks only
    async getPendingTasks() {
        try {
            const { data, error } = await this.pool.query(`
                SELECT t.*, r.timestamp as recorded_at, r.text as recording_text
                FROM tasks t
                JOIN recordings r ON t.recording_id = r.id
                WHERE t.status = 'pending'
                ORDER BY r.timestamp DESC
            `);

            if (error) throw error;
            return data.rows;
        } catch (error) {
            console.error('Error fetching pending tasks:', error);
            throw error;
        }
    }

    // Mark task as completed
    async completeTask(taskId, completedByRecordingId = null) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const result = await client.query(
                `UPDATE tasks 
                 SET status = 'completed', 
                     completed_at = NOW(),
                     completed_by_recording_id = $2
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [taskId, completedByRecordingId]
            );
            
            await client.query('COMMIT');
            
            if (result.rows.length > 0) {
                console.log(`✅ Task ${taskId} marked as completed`);
                return result.rows[0];
            } else {
                console.log(`❌ Task ${taskId} not found or already completed`);
                return null;
            }
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error completing task:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Find potential task completions in new recording
    async findPotentialTaskCompletions(recordingText, recordingId) {
        try {
            // Get all pending tasks
            const pendingTasks = await this.getPendingTasks();
            
            if (pendingTasks.length === 0) {
                return [];
            }
            
            const potentialMatches = [];
            const recordingLower = recordingText.toLowerCase();
            
            // Look for completion keywords + task similarity
            const completionKeywords = [
                'done', 'finished', 'completed', 'called', 'talked to', 
                'met with', 'spoke to', 'emailed', 'sent', 'bought',
                'picked up', 'dropped off', 'scheduled', 'booked'
            ];
            
            // Check if recording contains completion keywords
            const hasCompletionKeyword = completionKeywords.some(keyword => 
                recordingLower.includes(keyword)
            );
            
            if (hasCompletionKeyword) {
                // Find tasks that might be referenced in this recording
                for (const task of pendingTasks) {
                    const taskDescription = task.task_description.toLowerCase();
                    const taskWords = taskDescription.split(/\s+/).filter(word => word.length > 2);
                    
                    // Check for word overlap between recording and task
                    const matchingWords = taskWords.filter(word => 
                        recordingLower.includes(word)
                    );
                    
                    // If significant overlap, consider it a potential match
                    if (matchingWords.length >= Math.min(2, taskWords.length * 0.5)) {
                        potentialMatches.push({
                            taskId: task.id,
                            taskDescription: task.task_description,
                            recordingId: recordingId,
                            matchingWords: matchingWords,
                            confidence: matchingWords.length / taskWords.length
                        });
                    }
                }
            }
            
            // Sort by confidence (highest first)
            return potentialMatches.sort((a, b) => b.confidence - a.confidence);
            
        } catch (error) {
            console.error('Error finding task completions:', error);
            return [];
        }
    }

    // Get task completion suggestions for user confirmation
    async getTaskCompletionSuggestions(recordingId) {
        try {
            const result = await this.pool.query(`
                SELECT * FROM task_completion_suggestions 
                WHERE recording_id = $1 AND status = 'pending'
                ORDER BY confidence DESC
            `, [recordingId]);

            return result.rows;
        } catch (error) {
            console.error('Error fetching task completion suggestions:', error);
            return [];
        }
    }

    // Store task completion suggestion for user confirmation
    async createTaskCompletionSuggestion(taskId, recordingId, confidence, matchingWords) {
        try {
            // First create the suggestions table if it doesn't exist
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS task_completion_suggestions (
                    id SERIAL PRIMARY KEY,
                    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                    recording_id INTEGER REFERENCES recordings(id) ON DELETE CASCADE,
                    confidence DECIMAL(3,2),
                    matching_words TEXT[],
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT NOW(),
                    responded_at TIMESTAMP NULL
                )
            `);

            const result = await this.pool.query(`
                INSERT INTO task_completion_suggestions 
                (task_id, recording_id, confidence, matching_words)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `, [taskId, recordingId, confidence, matchingWords]);

            return result.rows[0];
        } catch (error) {
            console.error('Error creating task completion suggestion:', error);
            throw error;
        }
    }

    // Respond to task completion suggestion
    async respondToTaskSuggestion(suggestionId, response) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Update suggestion status
            const suggestionResult = await client.query(`
                UPDATE task_completion_suggestions 
                SET status = $2, responded_at = NOW()
                WHERE id = $1
                RETURNING *
            `, [suggestionId, response]);
            
            if (suggestionResult.rows.length === 0) {
                throw new Error('Suggestion not found');
            }
            
            const suggestion = suggestionResult.rows[0];
            
            // If user confirmed, complete the task
            if (response === 'confirmed') {
                await this.completeTask(suggestion.task_id, suggestion.recording_id);
            }
            
            await client.query('COMMIT');
            return suggestion;
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error responding to task suggestion:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Close database connection
    async close() {
        await this.pool.end();
        console.log('Database connection closed');
    }
}

module.exports = new DatabaseService();