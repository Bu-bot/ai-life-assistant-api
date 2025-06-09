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

    // Close database connection
    async close() {
        await this.pool.end();
        console.log('Database connection closed');
    }
}

module.exports = new DatabaseService();