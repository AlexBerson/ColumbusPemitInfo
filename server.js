const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware for parsing request bodies
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/', require('./routes/index'));

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});