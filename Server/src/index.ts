import { createApp } from "./app.js";
import { verifyGoogleToken } from "./auth.js";
import { mongoKanaStore } from "./kana/store.js";
import { mongoProgressStore } from "./progress/store.js";
import { analyzeConversation } from "./talk/analysis.js";
import { createLiveToken } from "./talk/live.js";
import { availablePlans } from "./talk/plan.js";
import { mongoTalkStore } from "./talk/store.js";
import { chooseDailyTopics } from "./talk/topics.js";
import { mongoVocabStore } from "./vocab/store.js";

export const app = createApp({
  verifyGoogleToken,
  kanaStore: mongoKanaStore,
  vocabStore: mongoVocabStore,
  progressStore: mongoProgressStore,
  talkStore: mongoTalkStore,
  createLiveToken,
  availablePlans,
  analyzeConversation,
  chooseDailyTopics,
});
