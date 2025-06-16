// backend/services/database.js - Version 2 with Task Status Tracking
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

    // Simple task completion detection
    async detectTaskCompletion(recordingText, recordingId) {
        try {
            const recordingLower = recordingText.toLowerCase();
            
            // Look for completion keywords
            const completionKeywords = [
                'done', 'finished', 'completed', 'called', 'talked to', 
                'met with', 'spoke to', 'emailed', 'sent', 'bought',
                'picked up', 'dropped off', 'scheduled', 'booked'
            ];
            
            // Check if recording contains completion keywords
            const detectedKeywords = completionKeywords.filter(keyword => 
                recordingLower.includes(keyword)
            );
            
            if (detectedKeywords.length > 0) {
                console.log(`🎯 Task completion keywords detected: [${detectedKeywords.join(', ')}]`);
                return {
                    hasCompletion: true,
                    keywords: detectedKeywords,
                    recordingId: recordingId,
                    recordingText: recordingText
                };
            }
            
            return { hasCompletion: false };
            
        } catch (error) {
            console.error('Error detecting task completion:', error);
            return { hasCompletion: false };
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

// Add these methods to your database.js file (before the closing bracket)

    // Project Management Methods
    
    // Get all active projects
    async getAllProjects() {
        try {
            const result = await this.pool.query(`
                SELECT p.*, 
                       COUNT(r.id) as recording_count,
                       MAX(r.timestamp) as last_recording_at
                FROM projects p
                LEFT JOIN recordings r ON p.id = r.project_id
                WHERE p.is_active = true
                GROUP BY p.id, p.name, p.description, p.color, p.is_active, p.created_at, p.updated_at
                ORDER BY p.created_at ASC
            `);

            return result.rows;
        } catch (error) {
            console.error('Error fetching projects:', error);
            throw error;
        }
    }

    // Create a new project
    async createProject(name, description = '', color = '#667eea') {
        try {
            const result = await this.pool.query(`
                INSERT INTO projects (name, description, color, is_active, created_at, updated_at)
                VALUES ($1, $2, $3, true, NOW(), NOW())
                RETURNING *
            `, [name.trim(), description.trim(), color]);

            console.log(`📁 Project created: ${name}`);
            return result.rows[0];
        } catch (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new Error('Project name already exists');
            }
            console.error('Error creating project:', error);
            throw error;
        }
    }

    // Update a project
    async updateProject(projectId, updates) {
        try {
            const { name, description, color, is_active } = updates;
            
            const result = await this.pool.query(`
                UPDATE projects 
                SET name = COALESCE($2, name),
                    description = COALESCE($3, description),
                    color = COALESCE($4, color),
                    is_active = COALESCE($5, is_active),
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *
            `, [projectId, name?.trim(), description?.trim(), color, is_active]);

            if (result.rows.length > 0) {
                console.log(`📝 Project ${projectId} updated`);
                return result.rows[0];
            } else {
                throw new Error('Project not found');
            }
        } catch (error) {
            console.error('Error updating project:', error);
            throw error;
        }
    }

    // Soft delete a project (mark as inactive)
    async deleteProject(projectId) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Check if project has recordings
            const recordingsCheck = await client.query(
                'SELECT COUNT(*) as count FROM recordings WHERE project_id = $1',
                [projectId]
            );
            
            const recordingCount = parseInt(recordingsCheck.rows[0].count);
            
            if (recordingCount > 0) {
                // Move recordings to General project before deleting
                const generalProject = await client.query(
                    "SELECT id FROM projects WHERE name = 'General' LIMIT 1"
                );
                
                if (generalProject.rows.length > 0) {
                    await client.query(
                        'UPDATE recordings SET project_id = $1 WHERE project_id = $2',
                        [generalProject.rows[0].id, projectId]
                    );
                }
            }
            
            // Mark project as inactive
            const result = await client.query(
                'UPDATE projects SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *',
                [projectId]
            );
            
            await client.query('COMMIT');
            
            if (result.rows.length > 0) {
                console.log(`🗑️ Project ${projectId} deleted (${recordingCount} recordings moved to General)`);
                return { project: result.rows[0], movedRecordings: recordingCount };
            } else {
                throw new Error('Project not found');
            }
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error deleting project:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Get recordings for a specific project
    async getProjectRecordings(projectId) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    r.id,
                    r.timestamp,
                    r.text,
                    r.word_count,
                    p.name as project_name,
                    p.color as project_color,
                    
                    -- Aggregate entities as before
                    COALESCE(JSON_AGG(DISTINCT pe.name) FILTER (WHERE pe.name IS NOT NULL), '[]'::json) as people,
                    COALESCE(JSON_AGG(DISTINCT t.task_description) FILTER (WHERE t.task_description IS NOT NULL), '[]'::json) as tasks,
                    COALESCE(JSON_AGG(DISTINCT e.event_name) FILTER (WHERE e.event_name IS NOT NULL), '[]'::json) as events,
                    COALESCE(JSON_AGG(DISTINCT tp.topic) FILTER (WHERE tp.topic IS NOT NULL), '[]'::json) as topics,
                    COALESCE(JSON_AGG(DISTINCT l.location_name) FILTER (WHERE l.location_name IS NOT NULL), '[]'::json) as locations,
                    COALESCE(JSON_AGG(DISTINCT i.item_name) FILTER (WHERE i.item_name IS NOT NULL), '[]'::json) as items
                    
                FROM recordings r
                LEFT JOIN projects p ON r.project_id = p.id
                LEFT JOIN people pe ON r.id = pe.recording_id
                LEFT JOIN tasks t ON r.id = t.recording_id
                LEFT JOIN events e ON r.id = e.recording_id
                LEFT JOIN topics tp ON r.id = tp.recording_id
                LEFT JOIN locations l ON r.id = l.recording_id
                LEFT JOIN items i ON r.id = i.recording_id
                
                WHERE r.project_id = $1
                GROUP BY r.id, r.timestamp, r.text, r.word_count, p.name, p.color
                ORDER BY r.timestamp DESC
            `, [projectId]);

            return result.rows.map(row => ({
                id: row.id,
                timestamp: row.timestamp,
                text: row.text,
                word_count: row.word_count,
                project: {
                    name: row.project_name,
                    color: row.project_color
                },
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
            console.error('Error fetching project recordings:', error);
            throw error;
        }
    }

    // Detect project from recording text (e.g., "Work: had a meeting")
    async detectProjectFromText(text) {
        try {
            // Look for "ProjectName:" pattern at the beginning of text
            const projectMatch = text.match(/^([^:]+):\s*(.+)/);
            
            if (projectMatch) {
                const projectName = projectMatch[1].trim();
                const contentWithoutProject = projectMatch[2].trim();
                
                // Check if project exists
                const result = await this.pool.query(
                    'SELECT * FROM projects WHERE LOWER(name) = LOWER($1) AND is_active = true',
                    [projectName]
                );
                
                if (result.rows.length > 0) {
                    return {
                        project: result.rows[0],
                        cleanedText: contentWithoutProject
                    };
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error detecting project from text:', error);
            return null;
        }
    }

    // Updated saveRecording method to handle projects
    async saveRecording(text, entities = {}, projectId = null) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            // If no projectId provided, try to detect from text
            let finalProjectId = projectId;
            let finalText = text;
            
            if (!projectId) {
                const projectDetection = await this.detectProjectFromText(text);
                if (projectDetection) {
                    finalProjectId = projectDetection.project.id;
                    finalText = projectDetection.cleanedText;
                    console.log(`📁 Auto-detected project: ${projectDetection.project.name}`);
                }
            }
            
            // If still no project, use General project
            if (!finalProjectId) {
                const generalProject = await client.query(
                    "SELECT id FROM projects WHERE name = 'General' AND is_active = true LIMIT 1"
                );
                if (generalProject.rows.length > 0) {
                    finalProjectId = generalProject.rows[0].id;
                }
            }

            // Calculate word count
            const wordCount = finalText.trim().split(/\s+/).length;

            // Insert main recording with project
            const recordingResult = await client.query(
                `INSERT INTO recordings (text, word_count, project_id, timestamp) 
                 VALUES ($1, $2, $3, NOW()) 
                 RETURNING id, timestamp`,
                [finalText, wordCount, finalProjectId]
            );

            const recordingId = recordingResult.rows[0].id;
            const timestamp = recordingResult.rows[0].timestamp;

            // Insert extracted entities into separate tables
            await this.insertEntities(client, recordingId, entities);

            await client.query('COMMIT');

            console.log(`📝 Recording saved with ID: ${recordingId}, Project: ${finalProjectId}`);
            
            return {
                id: recordingId,
                timestamp: timestamp,
                text: finalText,
                entities: entities,
                word_count: wordCount,
                project_id: finalProjectId
            };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error saving recording:', error);
            throw error;
        } finally {
            client.release();
        }
    }

}

module.exports = new DatabaseService();