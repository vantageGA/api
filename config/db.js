import mongoose from 'mongoose';

// Align with upcoming Mongoose defaults and silence deprecation warnings
mongoose.set('strictQuery', true);

const connectDB = async () => {
  try {
    // Prefer MONGO_URI, but also accept the common MONGODB_URI naming
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
      throw new Error(
        'Mongo connection string missing. Set MONGO_URI (or MONGODB_URI) in your environment.',
      );
    }

    const conn = await mongoose.connect(uri, {
      useUnifiedTopology: true,
      useNewUrlParser: true,
    });
    console.log(`MondoDb connected ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
