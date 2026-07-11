const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 80;

// Serve static assets from the 'dist' directory
app.use(express.static(path.join(__dirname, 'dist')));

// Serve index.html for all other routes (React Router fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend Express server listening on port ${PORT}`);
});
