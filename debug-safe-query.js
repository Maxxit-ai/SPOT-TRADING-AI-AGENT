const { MongoClient } = require('mongodb');

// Configuration - update these based on your environment
const SAFE_DEPLOYMENT_URI = process.env.SAFE_DEPLOYMENT_URI || 'mongodb://localhost:27017/safe-deployment-service';
const SAFE_DEPLOYMENT_DB = process.env.SAFE_DEPLOYMENT_DB || 'safe-deployment-service';
const SAFE_COLLECTION = process.env.SAFE_COLLECTION || 'safes';
const USERNAME = 'abhidavinci';

async function debugSafeQuery() {
    let client;

    try {
        console.log('🔍 Debugging Safe Query for user:', USERNAME);
        console.log('📋 Database Config:');
        console.log('   - URI:', SAFE_DEPLOYMENT_URI);
        console.log('   - Database:', SAFE_DEPLOYMENT_DB);
        console.log('   - Collection:', SAFE_COLLECTION);
        console.log('');

        // Connect to MongoDB
        client = new MongoClient(SAFE_DEPLOYMENT_URI);
        await client.connect();
        console.log('✅ Connected to MongoDB');

        const db = client.db(SAFE_DEPLOYMENT_DB);
        const collection = db.collection(SAFE_COLLECTION);

        console.log('📊 Collection Stats:');
        const stats = await collection.estimatedDocumentCount();
        console.log(`   - Total documents: ${stats}`);
        console.log('');

        // 1. Check if any documents exist with the username (case-insensitive)
        console.log('1️⃣ Searching for documents with username (case-insensitive)...');
        const usernameRegex = new RegExp(USERNAME, 'i');
        const usernameResults = await collection.find({
            $or: [
                { 'userInfo.userId': usernameRegex },
                { 'userInfo.username': usernameRegex },
                { 'userId': usernameRegex },
                { 'username': usernameRegex }
            ]
        }).toArray();

        console.log(`   Found ${usernameResults.length} documents with username pattern`);
        if (usernameResults.length > 0) {
            usernameResults.forEach((doc, index) => {
                console.log(`   Document ${index + 1}:`, JSON.stringify(doc, null, 2));
            });
        }
        console.log('');

        // 2. Check the exact query being used
        console.log('2️⃣ Running exact query from getUserSafe method...');
        const exactQuery = {
            'userInfo.userId': USERNAME,
            'status': 'active'
        };
        console.log('   Query:', JSON.stringify(exactQuery, null, 2));

        const exactResults = await collection.find(exactQuery).toArray();
        console.log(`   Found ${exactResults.length} documents with exact query`);
        if (exactResults.length > 0) {
            exactResults.forEach((doc, index) => {
                console.log(`   Document ${index + 1}:`, JSON.stringify(doc, null, 2));
            });
        }
        console.log('');

        // 3. Show all documents to understand the structure
        console.log('3️⃣ Showing first 5 documents to understand structure...');
        const sampleDocs = await collection.find({}).limit(5).toArray();
        sampleDocs.forEach((doc, index) => {
            console.log(`   Document ${index + 1}:`, JSON.stringify(doc, null, 2));
        });
        console.log('');

        // 4. Check different variations of the status field
        console.log('4️⃣ Checking for documents with different status values...');
        const statusValues = await collection.distinct('status');
        console.log('   Available status values:', statusValues);

        for (const status of statusValues) {
            const statusCount = await collection.countDocuments({ status });
            console.log(`   - "${status}": ${statusCount} documents`);
        }
        console.log('');

        // 5. Check for the user specifically with any status
        console.log('5️⃣ Checking for user with any status...');
        const userWithAnyStatus = await collection.find({
            'userInfo.userId': USERNAME
        }).toArray();

        console.log(`   Found ${userWithAnyStatus.length} documents for user (any status)`);
        if (userWithAnyStatus.length > 0) {
            userWithAnyStatus.forEach((doc, index) => {
                console.log(`   Document ${index + 1}:`, JSON.stringify(doc, null, 2));
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('🔌 Disconnected from MongoDB');
        }
    }
}

// Run the debug script
debugSafeQuery(); 