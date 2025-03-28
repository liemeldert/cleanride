import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

// Check if we're in a build/SSG context
const isServerRendering = typeof window === 'undefined' && process.env.NODE_ENV === 'production' && !process.env.MONGODB_URI;

if (!MONGODB_URI && !isServerRendering) {
  throw new Error('Please define the MONGODB_URI environment variable');
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn) {
    return { db: cached.conn.connection.db };
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return { db: cached.conn.connection.db };
}

export default connectToDatabase;