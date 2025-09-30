require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware for parsing request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Add this line to parse JSON bodies

// Routes
app.use('/', require('./index.js'));

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});