// Use ES Modules syntax (ensure "type": "module" in package.json)
import { MongoClient } from 'mongodb';

// Basic validation for MongoDB URI pattern
const MONGO_URI_REGEX = /^mongodb(?:\+srv)?:\/\/.+$/;

export default async function handler(req, res) {
  // 1. Allow CORS (consider restricting in production if possible, but complicates things)
  // Be very careful with permissive CORS headers on an unsecured endpoint.
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow requests from any origin
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS preflight request for CORS
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // 2. Check Method
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST', 'OPTIONS']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // 3. Parse Request Body
  let targetUri, operation, collectionName, databaseName, query, document, documents, update, options;
  try {
    // Ensure body exists and is parsed (Vercel usually does this)
    if (!req.body) {
       return res.status(400).json({ error: 'Missing request body' });
    }
    ({ targetUri, operation, collectionName, databaseName, query, document, documents, update, options } = req.body);
  } catch (parseError) {
    console.error("Body parsing error:", parseError);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // 4. *** Basic Validation ***
  if (!targetUri || !operation || !collectionName) {
    return res.status(400).json({ error: 'Missing required fields in body: targetUri, operation, and collectionName' });
  }
  if (typeof targetUri !== 'string' || !MONGO_URI_REGEX.test(targetUri)) {
     return res.status(400).json({ error: 'Invalid targetUri format. Must be a valid MongoDB connection string.' });
  }
  // WARNING: Accepting arbitrary connection strings without validation is dangerous.

  // 5. Determine Database Name
  let dbName = databaseName; // Use provided name if available
  if (!dbName) {
    try {
      // Attempt to parse from URI
      const url = new URL(targetUri);
      dbName = url.pathname.substring(1) || null; // Get path after host, remove leading '/'
      if (!dbName && url.searchParams.has('authSource')) { // Check authSource for SRV records often
        dbName = url.searchParams.get('authSource');
      }
      if (!dbName) {
         // Cannot determine DB - require it in request if not parsable
         return res.status(400).json({ error: 'Could not determine database name from targetUri. Please provide databaseName in the request body.' });
      }
    } catch (uriError) {
      console.error("Error parsing targetUri:", uriError);
      return res.status(400).json({ error: 'Could not parse targetUri to determine database name.' });
    }
  }

  let client = null; // Do not reuse client when URI can change per request
  try {
    // 6. Connect to the SPECIFIED MongoDB using the URI from the request
    // INEFFICIENT: Establishes a new connection for every request!
    // Add serverApi if needed: const client = new MongoClient(targetUri, { serverApi: { version: ServerApiVersion.v1 } });
    client = new MongoClient(targetUri);
    await client.connect();

    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    let result;

    // 7. Perform the requested operation (Switch statement)
    switch (operation) {
       case 'find':
         result = await collection.find(query || {}, options || {}).toArray();
         break;
       case 'findOne':
         result = await collection.findOne(query || {}, options || {});
         break;
       case 'insertOne':
         if (document === undefined) return res.status(400).json({ error: 'Missing field: document for insertOne' });
         result = await collection.insertOne(document, options || {});
         break;
       case 'insertMany':
         if (!documents || !Array.isArray(documents)) return res.status(400).json({ error: 'Missing or invalid field: documents array for insertMany' });
         result = await collection.insertMany(documents, options || {});
         break;
       case 'updateOne':
         if (query === undefined || update === undefined) return res.status(400).json({ error: 'Missing fields: query and update for updateOne' });
         result = await collection.updateOne(query, update, options || {});
         break;
       case 'updateMany':
         if (query === undefined || update === undefined) return res.status(400).json({ error: 'Missing fields: query and update for updateMany' });
         result = await collection.updateMany(query, update, options || {});
         break;
       case 'deleteOne':
         if (query === undefined) return res.status(400).json({ error: 'Missing field: query for deleteOne' });
         result = await collection.deleteOne(query, options || {});
         break;
       case 'deleteMany':
         if (query === undefined) return res.status(400).json({ error: 'Missing field: query for deleteMany' });
         result = await collection.deleteMany(query, options || {});
         break;
      case 'countDocuments':
         result = await collection.countDocuments(query || {}, options || {});
         break;
      case 'aggregate':
        if (!query || !Array.isArray(query)) return res.status(400).json({ error: 'Missing or invalid field: query (pipeline array) for aggregate' });
        result = await collection.aggregate(query, options || {}).toArray();
        break;
      // Add other operations like findOneAndUpdate etc. as needed
      default:
        return res.status(400).json({ error: `Unsupported operation: ${operation}` });
    }

    // 8. Send Success Response
    return res.status(200).json({ success: true, data: result });

  } catch (error) {
    console.error('MongoDB operation failed:', error);
    // 9. Send Error Response (avoid leaking too much detail)
    return res.status(500).json({ success: false, error: 'Internal Server Error processing MongoDB request', details: process.env.NODE_ENV !== 'production' ? error.message : undefined });
  } finally {
    // 10. Close connection since we create a new one each time
    if (client) {
      await client.close();
    }
  }
}