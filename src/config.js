const { MongoClient } = require('mongodb');

const url = 'mongodb://localhost:27017';
const dbName = 'aml';

const client = new MongoClient(url);

client.connect().then(() => {
    console.log("Database connect Successfully");
}).catch((err) => {
    console.log("Error in Database connection", err);
});

const db = client.db(dbName);
const collection = db.collection('users');

module.exports = collection;
