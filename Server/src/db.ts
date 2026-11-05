import { MongoClient, type Db } from "mongodb";
import { requireEnv } from "./env.js";

// Reused across requests so serverless invocations don't reconnect every time.
let clientPromise: Promise<MongoClient> | undefined;

export async function getDb(): Promise<Db> {
  clientPromise ??= new MongoClient(requireEnv("MONGODB_URI"), { serverSelectionTimeoutMS: 8000 })
    .connect()
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  return (await clientPromise).db("japanese_tutor");
}
