import { createApp } from "./app.js";
import { verifyGoogleToken } from "./auth.js";
import { mongoKanaStore } from "./kana/store.js";
import { mongoVocabStore } from "./vocab/store.js";

export const app = createApp({ verifyGoogleToken, kanaStore: mongoKanaStore, vocabStore: mongoVocabStore });
