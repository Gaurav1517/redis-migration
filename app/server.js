const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('redis');

const app = express();
app.use(bodyParser.json());

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || '6379';
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';

const redisUrl = `redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}`;

const client = createClient({
  url: redisUrl,
});

let redisConnected = false;

client.on('error', (err) => {
  console.error('Redis Client Error', err);
  redisConnected = false;
});

client.on('connect', () => {
  console.log('Connecting to Redis...');
});

client.on('ready', () => {
  console.log('Redis connection is ready');
  redisConnected = true;
});

(async () => {
  try {
    await client.connect();
  } catch (err) {
    console.error('Failed to connect to Redis on startup:', err);
  }
})();

app.get('/', (req, res) => {
  res.json({
    message: 'Redis Migration Demo App',
    redis: {
      host: REDIS_HOST,
      port: REDIS_PORT,
      connected: redisConnected,
    },
    endpoints: {
      health: '/health',
      redisHealth: '/redis-health',
      set: 'POST /set { "key": "...", "value": "..." }',
      get: 'GET /get?key=...',
      incr: 'POST /incr { "key": "counter" }',
    },
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/redis-health', async (req, res) => {
  try {
    const pong = await client.ping();
    res.json({ status: 'ok', redis: 'connected', ping: pong });
  } catch (err) {
    console.error('Redis health check failed:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.post('/set', async (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'Key is required' });
  }
  try {
    await client.set(key, value);
    res.json({ status: 'ok', key, value });
  } catch (err) {
    console.error('Error in /set:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/get', async (req, res) => {
  const key = req.query.key;
  if (!key) {
    return res.status(400).json({ error: 'Key is required' });
  }
  try {
    const value = await client.get(key);
    res.json({ status: 'ok', key, value });
  } catch (err) {
    console.error('Error in /get:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/incr', async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'Key is required' });
  }
  try {
    const newVal = await client.incr(key);
    res.json({ status: 'ok', key, value: newVal });
  } catch (err) {
    console.error('Error in /incr:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Redis demo app listening on port ${PORT}`);
});
