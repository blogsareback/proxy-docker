// Express server entry point for BAB Proxy

import express from 'express'
import { PORT, MAX_REQUEST_BODY } from './lib/config.js'
import { corsMiddleware } from './lib/cors.js'
import { handleHealth } from './handlers/health.js'
import { handleFetch } from './handlers/fetch.js'
import { handleParse } from './handlers/parse.js'
import { handleDiscover } from './handlers/discover.js'

const app = express()

// Middleware
app.use(express.json({ limit: MAX_REQUEST_BODY }))
app.use(corsMiddleware)

// Routes
app.get('/health', handleHealth)
app.post('/fetch', handleFetch)
app.post('/parse', handleParse)
app.post('/discover', handleDiscover)

// Root route - redirect to health
app.get('/', (_req, res) => {
  res.redirect('/health')
})

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  })
})

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`BAB Proxy server running on port ${PORT}`)
  console.log(`Health check: http://localhost:${PORT}/health`)
})
