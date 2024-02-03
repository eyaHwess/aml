const express = require('express');
const session = require('express-session');
const { MongoClient } = require('mongodb');
const app = express();
const bcrypt = require('bcrypt');
const collection = require('./config');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const cors = require('cors');
const cookieParser = require('cookie-parser');
app.use(cookieParser());

app.use(cors());

const port = 5000;
app.set('view engine', 'ejs');
// Add these lines to enable body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const uri = 'mongodb://localhost:27017/aml';
const client = new MongoClient(uri);

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    return client;
  } catch (error) {
    console.error('Error connecting to MongoDB', error);
    throw error;
  }
}

app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
}));

app.use((req, res, next) => {
  // Set additional headers to prevent caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Expires', '0');
  res.setHeader('Pragma', 'no-cache');
  next();
});
//Login link
app.get('/', (req, res) => {
  res.render('login');
});

function generateToken(user) {
  return jwt.sign({ username: user.username }, 'your-secret-key', { expiresIn: '1h' });
}

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await collection.findOne({ username });

    console.log('Fetched User Data:', user);

    if (!user) {
      res.send("Username not found");
      return;
    }

    const isPasswordMatch = await bcrypt.compare(password, user.password);

    if (isPasswordMatch) {
      // Generate a JWT token
      const token = generateToken(user);

      console.log('Generated Token:', token);

      // Send the token as a cookie
      res.cookie('token', token, { httpOnly: true, maxAge: 3600000 }); // 1 hour expiration

      console.log('User logged in:', user);

      res.redirect('/home');
    } else {
      res.send("Wrong password");
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send(`An error occurred during login: ${error.message}`);
  }
});

// Add this middleware to check for the presence of a valid token
// Add this middleware to check for the presence of a valid token
// Add this middleware to check for the presence of a valid token
function authenticateToken(req, res, next) {
  const token = req.cookies.token;

  console.log('Received Token:', token); // Add this log

  if (!token) {
    console.log('Token not present, redirecting to login');
    // Redirect only if the user is logged in
    if (req.session.user && req.session.user.username) {
      return res.redirect('/'); // Redirect to login
    }
    return next(); // Continue to the next middleware if the user is not logged in
  }

  jwt.verify(token, 'your-secret-key', (err, user) => {
    if (err || !user || !user.username) {
      console.error('Error verifying token or missing user information, redirecting to login:', err);
      return res.redirect('/');
    }

    // Ensure req.user is defined and has a username
    req.user = { username: user.username };

    console.log('Token verified, proceeding to the next middleware');
    next();
  });
}





// Signup route
app.get('/signup', (req, res) => {
  // Pass the error variable to the EJS template
  res.render('signup', { error: null });
});

app.post('/signup', async (req, res) => {
  const { email, username, password, confirmPassword } = req.body;

  // Validate form data
  if (!email || !username || !password || !confirmPassword) {
    return res.render('signup', { error: 'All fields are required' });
  }

  if (password !== confirmPassword) {
    return res.render('signup', { error: 'Passwords do not match' });
  }

  // Check if email or username already exists
  const existingUser = await collection.findOne({ $or: [{ email }, { username }] });

  if (existingUser) {
    return res.render('signup', { error: 'Email or username already exists' });
  }

  // Hash the password (you can use bcrypt)
  const hashedPassword = await bcrypt.hash(password, 10);

  // Store user information in MongoDB
  try {
    await collection.insertOne({ email, username, password: hashedPassword });
    res.redirect('/'); // Redirect to the login page after successful signup
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).send('Internal Server Error');
  }
});



//adding cin
async function searchByNameCin(dbName, collectionName, firstName, lastName, cin) {
  const db = client.db(dbName);
  const collection = db.collection(collectionName);

  try {
    const mongoResults = await collection.find({}).toArray();

    // Combine first and last names into a single string for fuzzy searching
    const fullNameResults = mongoResults.map(item => ({
      ...item,
      fullName: `${item.prenom} ${item.nom} ${item.cin}`,
    }));

    // Perform fuzzy search using a custom function
    const results = fullNameResults.map(item => {
      const fullName = item.fullName.toLowerCase();
      const query = `${firstName} ${lastName} ${cin}`; // No need to convert cin to lowercase

      const similarity = calculateSimilarity(fullName, query) * 100;
      return {
        item: { ...item, fullName: undefined }, // Hide the fullName in the output
        similarity: parseFloat(similarity.toFixed(2)), // Round to 2 decimal places
      };
    });

    // Adjust the threshold dynamically based on the length of the input
    const inputLength = `${firstName} ${lastName} ${cin}`.length;
    const adjustedThreshold = 0.2 + (inputLength / 20); // You can experiment with this formula

    // Filter results based on the adjusted threshold and minimum similarity
    const finalResults = results.filter(result => {
      return result.similarity >= adjustedThreshold && result.similarity >= 40;
    });

    return finalResults;

  } catch (error) {
    console.error('Error searching for data:', error);
    throw error;
  }
}


// Custom function to calculate similarity using Levenshtein distance
function calculateSimilarity(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;

  // Calculate Levenshtein distance
  const matrix = Array.from({ length: len1 + 1 }, (_, i) =>
    Array.from({ length: len2 + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const levenshteinDistance = matrix[len1][len2];

  // Calculate similarity percentage with length adjustment
  const maxLength = Math.max(len1, len2);
  const adjustedSimilarity = 1 - levenshteinDistance / maxLength;

  return Math.max(adjustedSimilarity, 0);
}

// Example route handling in app.js
// app.get('/search', async (req, res) => {
//   console.log('Received search request:', req.query);

//   try {
//     const results = await searchByName('aml', 'criminals', req.query.prenom, req.query.nom);
//     console.log('Search results:', results);

//     res.json(results);
//   } catch (error) {
//     console.error('Error searching for data:', error);
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// });

//adding cin
app.get('/search', async (req, res) => {
  console.log('Received search request:', req.query);

  try {
    const results = await searchByNameCin('aml', 'criminals', req.query.prenom, req.query.nom, req.query.cin);
    console.log('Search results:', results);

    res.json(results);
  } catch (error) {
    console.error('Error searching for data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Add the /home route with token authentication
// app.get('/home', authenticateToken, (req, res) => {
//   console.log('Rendering home page for', req.user.username); // Use req.user directly
//   res.render('home', { username: req.user.username });
// });




app.get("/logout", (req, res) => {
  res.clearCookie('token'); // Clear the token cookie
  res.redirect("/"); // Redirect to the login page
});
app.get('/home', authenticateToken, (req, res) => {
  if (!req.user) {
    console.log('User not authenticated, redirecting to login');
    return res.redirect('/');
  }

  console.log('Rendering home page for', req.user.username); 
  res.render('home', { username: req.user.username ,email: req.user.email });
});


//update
// Update the /update-profile route to fetch user details and render the view
app.get('/user_profile', authenticateToken, async (req, res) => {
  if (!req.user) {
    console.log('User not authenticated, redirecting to login');
    return res.redirect('/');
  }

  try {
    const user = await collection.findOne({ username: req.user.username });

    if (!user) {
      console.log('User not found in the database');
      return res.status(500).send('Internal Server Error');
    }

    console.log('Rendering user_profile page for', req.user.username);

    // Render the user_profile page and pass user details
    res.render('user_profile', {
      username: user.username,
      email: user.email
      // Add other fields you want to pass to the view
    });
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).send('Internal Server Error');
  }
});
// Add this route to handle changes in user profile
app.post('/user_profile', authenticateToken, async (req, res) => {
  try {
    const { username, lastPassword, newPassword, confirmNewPassword } = req.body;
    const user = await collection.findOne({ username: req.user.username });

    if (!user) {
      console.log('User not found in the database');
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    // If the username is changed, update it in the database
    if (username && username !== req.user.username) {
      await collection.updateOne({ username: req.user.username }, { $set: { username } });
    }

    // If changing password, verify the last password and update the new one
    if (newPassword && confirmNewPassword) {
      // Check if the last password matches
      const isLastPasswordMatch = await bcrypt.compare(lastPassword, user.password);

      if (!isLastPasswordMatch) {
        return res.status(400).json({ error: 'Last password does not match' });
      }

      // Check if the new password and confirm password match
      if (newPassword !== confirmNewPassword) {
        return res.status(400).json({ error: 'New passwords do not match' });
      }

      // Hash the new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);

      // Update the password in the database
      await collection.updateOne({ username: req.user.username }, { $set: { password: hashedNewPassword } });
    }
    res.redirect('/home');

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving changes:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Start the server
connectToMongoDB().then(() => {
  app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
  });
});