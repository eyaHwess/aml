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

const port = 5000; // Define port for the server
app.set('view engine', 'ejs'); // Set view engine to EJS for rendering templates

// Enable body parsing for URL-encoded and JSON bodies
//Cette ligne configure un middleware pour analyser les requêtes entrantes avec des charges utiles encodées en URL.
app.use(express.urlencoded({ extended: true }));

//Cette ligne configure un middleware pour analyser les requêtes entrantes avec des charges utiles JSON(utilisées pour envoyer des données entre un client et un serveur dans le corps d'une requête au format JSON).
app.use(express.json());

const uri = 'mongodb://localhost:27017/aml'; // MongoDB connection URI
const client = new MongoClient(uri); // Create a new MongoDB client instance

// Function to connect to MongoDB database asynchronously
async function connectToMongoDB() {
  try {
    await client.connect(); // Connect to MongoDB
    console.log('Connected to MongoDB');
    return client; // Return the MongoDB client instance
  } catch (error) {
    console.error('Error connecting to MongoDB', error);
    throw error; // Throw error if connection fails
  }
}

// Set up session middleware with configuration
app.use(session({
  secret: 'your-secret-key', // Secret key for session encryption
  resave: false,
  saveUninitialized: true,
}));

// Middleware to set additional headers to prevent caching
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Expires', '0');
  res.setHeader('Pragma', 'no-cache');
  next(); // Call next middleware
});

// Route for login page
app.get('/', (req, res) => {
  res.render('login'); // Render login page using EJS template
});

// Function to generate JWT token for user
function generateToken(user) {
  return jwt.sign({ username: user.username }, 'your-secret-key', { expiresIn: '1h' });
}

// Route for handling login POST requests
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body; // Extract username and password from request body

    const user = await collection.findOne({ username }); // Find user in MongoDB

    console.log('Fetched User Data:', user);

    if (!user) {
      return res.render('login', { error: 'Username not found' }); // Render login page with error if username not found
    }
    const isPasswordMatch = await bcrypt.compare(password, user.password); // Compare passwords

    if (isPasswordMatch) {
      // Generate a JWT token
      const token = generateToken(user);

      console.log('Generated Token:', token);

      // Send the token as a cookie
      res.cookie('token', token, { httpOnly: true, maxAge: 3600000 }); // Set token as cookie with 1-hour expiration

      console.log('User logged in:', user);

      res.redirect('/home'); // Redirect to home page after successful login
    } else {
      return res.render('login', { error: 'Wrong username or password' }); // Render login page with error for wrong credentials
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send(`An error occurred during login: ${error.message}`); // Send error response
  }
});

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const token = req.cookies.token; // Get token from cookie

  console.log('Received Token:', token); // Log received token

  if (!token) {
    console.log('Token not present, redirecting to login');
    if (req.session.user && req.session.user.username) {
      return res.redirect('/'); // Redirect to login if token is not present
    }
    return next(); // Call next middleware if user is not logged in
  }

  jwt.verify(token, 'your-secret-key', (err, user) => {
    if (err || !user || !user.username) {
      console.error('Error verifying token or missing user information, redirecting to login:', err);
      return res.redirect('/'); // Redirect to login if token verification fails
    }

    req.user = { username: user.username }; // Set user information in request object
    console.log('Token verified, proceeding to the next middleware');
    next(); // Call next middleware
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
// Asynchronous function to search for records based on first name, last name, and CIN
async function searchByNameCin(dbName, collectionName, firstName, lastName, cin) {
  // Connect to the MongoDB database and collection
  const db = client.db(dbName);
  const collection = db.collection(collectionName);

  try {
    // Retrieve all documents from the collection
    const mongoResults = await collection.find({}).toArray();

    // Prepare data for fuzzy search
    // -----------------------------------------
    // Combine first/last names and CIN into a single field for efficient fuzzy matching
    const fullNameResults = mongoResults.map(item => ({
      ...item,  // Copy all existing fields
      fullName: `${item.prenom} ${item.nom} ${item.cin}`,  // Create a combined fullName field
    }));

    // Perform fuzzy search using a custom similarity function
    // -----------------------------------------
    const results = fullNameResults.map(item => {
      const fullName = item.fullName.toLowerCase();  // Convert to lowercase for case-insensitive matching
      const query = `${firstName} ${lastName} ${cin}`;  // No need to lowercase cin (assume it's case-sensitive)

      const similarity = calculateSimilarity(fullName, query) * 100;  // Calculate similarity percentage
      return {
        item: { ...item, fullName: undefined },  // Remove fullName from the output
        similarity: parseFloat(similarity.toFixed(2)),  // Round to 2 decimal places
      };
    });

    // Dynamically adjust the similarity threshold based on input length
    // -----------------------------------------
    const inputLength = `${firstName} ${lastName} ${cin}`.length;
    const adjustedThreshold = 0.2 + (inputLength / 20);  // Adjust threshold for longer inputs

    // Filter results based on adjusted threshold and a minimum similarity of 40%
    const finalResults = results.filter(result => {
      return result.similarity >= adjustedThreshold && result.similarity >= 40;
    });

    return finalResults;  // Return the filtered results

  } catch (error) {
    console.error('Error searching for data:', error);
    throw error;
  }
}

// Custom function to calculate string similarity using Levenshtein distance
function calculateSimilarity(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;

  // Calculate Levenshtein distance
  // -----------------------------------------
  const matrix = Array.from({ length: len1 + 1 }, (_, i) =>
    Array.from({ length: len2 + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;  // Cost of substitution
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,  // Insertion
        matrix[i][j - 1] + 1,  // Deletion
        matrix[i - 1][j - 1] + cost  // Substitution
      );
    }
  }

  const levenshteinDistance = matrix[len1][len2];

  // Calculate similarity percentage with length adjustment
  // -----------------------------------------
  const maxLength = Math.max(len1, len2);
  const adjustedSimilarity = 1 - levenshteinDistance / maxLength;

  return Math.max(adjustedSimilarity, 0);  // Ensure similarity is always non-negative
}

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

    // If the username is changed, check if it is unique
    if (username && username !== req.user.username) {
      const existingUser = await collection.findOne({ username });

      if (existingUser) {
        return res.status(400).json({ error: 'Username is already taken' });
      }

      // Update the username in the database
      await collection.updateOne({ username: req.user.username }, { $set: { username } });

      // Render the user_profile page again with updated data
      return res.render('user_profile', {
        username: username,
        email: user.email 
      });
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

    // If changes saved successfully, return a JSON response
     res.json({ success: true });
return res.render('home',{username:req.user.username})

  } catch (error) {
    console.error('Error saving changes:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Start the server
connectToMongoDB().then(() => {
  app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
  });
});