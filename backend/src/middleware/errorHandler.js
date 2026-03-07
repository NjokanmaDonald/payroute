function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} — ${status}: ${message}`);
    if (status === 500) console.error(err.stack);
  }

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
