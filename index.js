const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://columbus.permitinfo.net';

// Store cookies between requests
const cookieJar = {};

router.get('/', (req, res) => {
  res.render('index', { title: 'ASP.NET Scraper' });
});

router.post('/login', async (req, res) => {
  try {
    // Step 1: GET the login page to get __VIEWSTATE and cookies
    const initialResponse = await axios.get(`${BASE_URL}/index.aspx`);
    const $ = cheerio.load(initialResponse.data);

    // Store cookies
    const cookies = initialResponse.headers['set-cookie'];
    if (cookies) {
      cookieJar.session = cookies.map(c => c.split(';')[0]).join('; ');
    }

    // Extract form data
    const viewState = $('#__VIEWSTATE').val();
    const eventValidation = $('#__EVENTVALIDATION').val();

    // Step 2: POST to login
    const loginPayload = new URLSearchParams();
    loginPayload.append('__EVENTTARGET', 'Menu1$LoginLink');
    loginPayload.append('__EVENTARGUMENT', '');
    loginPayload.append('__VIEWSTATE', viewState);
    loginPayload.append('__EVENTVALIDATION', eventValidation);
    loginPayload.append('ctl00$MainContent$txtUsername', 'hardcoded_username'); // Replace with real username
    loginPayload.append('ctl00$MainContent$txtPassword', 'hardcoded_password'); // Replace with real password
    loginPayload.append('ctl00$MainContent$btnLogin', 'Login');

    const loginResponse = await axios.post(`${BASE_URL}/index.aspx`, loginPayload, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieJar.session || '',
        'Referer': `${BASE_URL}/index.aspx`
      },
      // Important to see where we are redirected
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400, // Accept redirects (302)
    });

    console.log('Login response status:', loginResponse.status);
    console.log('Login response headers:', loginResponse.headers);

    // For now, just redirect back home with a success message
    res.render('index', { title: 'ASP.NET Scraper', message: 'Login attempt sent. Check console.' });
  } catch (error) {
    console.error('An error occurred:', error.message);
    res.render('index', { title: 'ASP.NET Scraper', message: `Error: ${error.message}` });
  }
});

module.exports = router;