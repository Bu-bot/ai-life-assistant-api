// backend/test-db.js
// Simple test to check database connection
require('dotenv').config();
const { Pool } = require('pg');

console.log('Testing database connection...');
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL starts with postgresql:', process.env.DATABASE_URL?.startsWith('postgresql:'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function testConnection() {
    try {
        console.log('Attempting to connect...');
        const client = await pool.connect();
        console.log('✅ Database connected successfully!');
        
        const result = await client.query('SELECT NOW()');
        console.log('✅ Query test successful:', result.rows[0]);
        
        client.release();
        await pool.end();
        console.log('✅ Connection closed');
    } catch (error) {
        console.error('❌ Database connection failed:');
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        process.exit(1);
    }
}

testConnection();