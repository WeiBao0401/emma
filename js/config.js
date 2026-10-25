// Keep VERSION identical to VERSION in sw.js; bump both on every release (tests/run.mjs checks).
export const VERSION = '0.8.0';

export const API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

// Models (SPEC 5): picked 2026-10-16 from the Bailian docs. note = price in CNY per 1M tokens, input / output.
export const DEFAULT_MODELS = { core: 'qwen3.8-flash', extras: 'qwen3.7-plus', zh: 'qwen3.8-max' };
// Changing DEFAULT_MODELS reaches every profile whose models were never changed in 我的 (settings.modelsChosen false):
// loadSettings in db.js swaps them on the next launch. A model picked in 我的 sets modelsChosen and is never replaced.
// OLD_DEFAULT_MODEL is the default up to v0.3, saved before modelsChosen existed: there, three of it count as never
// changed (SPEC 2.4).
export const OLD_DEFAULT_MODEL = 'qwen-plus';
export const MODEL_CHOICES = [
  { id: 'qwen3.8-flash', label: '快速 · 查词推荐', tier: 'fast', note: '0.8 / 2.7 元' },
  { id: 'qwen3.7-flash', label: '快速 · 最省钱', tier: 'fast', note: '0.2 / 0.8 元' },
  { id: 'qwen3.7-plus', label: '均衡 · 扩展推荐', tier: 'balanced', note: '2 / 8 元' },
  { id: 'qwen3.8-max', label: '最强 · 中译英推荐', tier: 'max', note: '12 / 36 元' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek · 实验', tier: 'experimental', note: '12 / 24 元' },
  { id: 'qwen-plus', label: '旧版 · 兜底', tier: 'legacy', note: '0.8 / 2 元' },
];
// Poe through a relay (DESIGN 10.8). The code is kept from the dictionary, but v0 runs on Bailian only:
// POE_ENABLED false hides the Poe rows in the parent area and loadSettings (db.js) reads any saved provider as Bailian.
// The address is https://<domain>/<secret>/v1; POE_DIRECT_URL works wherever Poe is reachable.
// Picked 2026-10-24 from the Poe /v1/models list; note = USD per 1M tokens, input / output.
export const POE_ENABLED = false;
export const POE_DIRECT_URL = 'https://api.poe.com/v1';
export const POE_DEFAULT_MODELS = { core: 'claude-sonnet-5.5', extras: 'claude-sonnet-5.5', zh: 'claude-sonnet-5.5' };
export const POE_MODEL_CHOICES = [
  { id: 'claude-sonnet-5.5', label: '均衡 · 推荐', tier: 'balanced', note: '2 / 10 美元' },
  { id: 'claude-haiku-5.5', label: '快速 · 最省钱', tier: 'fast', note: '0.1 / 0.5 美元' },
  { id: 'gpt-5.4-mini', label: '快速 · OpenAI', tier: 'fast', note: '0.68 / 4.09 美元' },
  { id: 'gemini-3.8-flash', label: '快速 · Google', tier: 'fast', note: '0.76 / 3.79 美元' },
  { id: 'gpt-5.4', label: 'OpenAI 最强', tier: 'max', note: '2.27 / 13.64 美元' },
  { id: 'claude-opus-4.8', label: '最强 · 最贵', tier: 'max', note: '4.29 / 21.46 美元' },
];
// Poe needs max_tokens: Claude models on Poe spend part of it on hidden reasoning and may still say "stop", so a
// reply that used the whole budget counts as cut off and is asked for once more with double (same as server.py).
export const POE_BUDGET = { core: 3000, lexicon: 4500, practice: 4000, zh: 3500, story: 3500 };
export const POE_MAX_BUDGET = 9000;

// 我的 → 模型 → 测一下速度: the real core prompt for this word, once per model, with this timeout each
export const SPEED_WORD = 'meticulous';
export const SPEED_TIMEOUT_MS = 30000;

// No max_tokens: the Bailian json-mode doc says not to set it with structured output. A reply cut off anyway
// (finish_reason "length") is asked for once more, then reported (ai.js).
export const RETRY_DELAYS = [1500, 3000];
export const TIMEOUT_MS = { core: 40000, lexicon: 60000, practice: 60000, zh: 45000, story: 60000 };

// Emma's data (SPEC.md, CONTRACTS.md). Same origin as Wei's dictionary (weibao0401.github.io), so every name here
// must differ from its "wordcoach" ones. DB_VERSION never goes down (IndexedDB cannot downgrade); version 1 already
// has every store v0 to v2 need (db.js upgradeDB), new fields go inside records, not into new stores.
export const DB_NAME = 'emma';
export const DB_VERSION = 1;
// Qwen voice clips, separate so the main database keeps its version and a rollback stays safe
export const AUDIO_DB_NAME = 'emma-audio';
export const AUDIO_DB_VERSION = 1;
export const DB_TIMEOUT_MS = 8000;
export const LOG_CAP = 3000;
// Raw answer events kept on the iPad (teacher-memory 2.1: 180 days, then daily totals only); events.js trims.
export const EVENTS_KEEP_DAYS = 180;

// New words opened a day (DESIGN 5.1: usually 3-4 on a school day; plan.js may lower it when reviews pile up)
export const NEW_PER_DAY = 4;
export const LIB_CHUNK = 150;
export const SHRINK_RATIO = 0.8;

export const DEFAULT_SETTINGS = {
  apiKey: '',          // Bailian; also the Qwen voice key when lookups go through Poe
  models: { ...DEFAULT_MODELS },
  provider: 'bailian', // 'bailian' | 'poe': who answers lookups (SPEC 5.2)
  poeUrl: '',          // relay address, normalized by normalizePoeUrl in ai.js
  poeKey: '',
  poeModels: { ...POE_DEFAULT_MODELS },
  modelsChosen: false, // true once a model is changed in 我的; while false, the models follow DEFAULT_MODELS (loadSettings)
  mock: false,
  guessFirst: true,
  newPerDay: NEW_PER_DAY,
  voice: '',          // system voice name ('' = best installed English voice)
  voiceMode: '',      // 'qwen' | 'system'; '' = Qwen when an API key is set, else system (see voiceMode() in tts.js)
  qwenVoice: 'Ava_v3.1',   // Wei 10-24 picked Ava (tts-samples/listen-2-Ava); follows this default until picked by hand
  voiceChosen: false,
  dailyCapYuan: 1.5,  // in-app daily spending cap (DESIGN 10.7); budget.js reads it
  // per-kind daily caps (budget.js). 问老师 and 语音输入 are not held by dailyCapYuan (v0.4.1), only by these
  kindCapsYuan: { chat: 5, asr: 1 },
  // 问老师 (v0.3.0, chat.js chatRoute): 'auto' = Poe when the relay address and the Poe Key are both filled, else Bailian.
  // Poe uses poeUrl / poeKey above (POE_ENABLED only gates lookups, not 问老师).
  chatProvider: 'auto',
  chatModelBailian: 'qwen3.8-max',
  chatModelPoe: 'gpt-5.4',
  // 语音输入 (v0.3.0, voice-input.js asrRoute): 'auto' = 豆包 when doubaoToken is filled, else Bailian (apiKey).
  // 豆包 old console: doubaoAppId + doubaoToken (Access Token); new console: the API Key in doubaoToken, no App ID.
  // doubaoCluster is the streaming resource id ('' = volc.seedasr.sauc.duration, 豆包流式语音识别 2.0, words appear as she
  // speaks). A recording-file resource like volc.bigasr.auc_turbo is only used by the 极速版 fallback.
  asrProvider: 'auto',
  doubaoAppId: '',
  doubaoToken: '',
  doubaoCluster: '',
  // 0.6.0 句子里回想 (modes/cloze.js inputOf): 'tiles' letter tiles (default), 'keys' the on-screen keyboard. CONTRACTS: the
  // keyboard waits until the 体检页 says it is safe on her iPad
  spellMode: 'tiles',
};

// Qwen TTS (SPEC 5.1): same Bailian key and host as the chat calls. The audio comes back as a 24 h link
// on one of the result buckets below (all send Access-Control-Allow-Origin: *); index.html's CSP lists them.
export const TTS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const TTS_MODEL = 'qwen3-tts-flash';
export const TTS_RESULT_HOSTS = ['dashscope-result-bj.oss-cn-beijing.aliyuncs.com', 'dashscope-result-sh.oss-cn-shanghai.aliyuncs.com',
  'dashscope-result-hz.oss-cn-hangzhou.aliyuncs.com'];
// The newer Bailian voices (v0.1.5, research/08-tts-options.md, tts-samples/): qwen-audio-3.1-tts-flash on the
// SpeechSynthesizer endpoint, same host and key, CORS open for weibao0401.github.io, audio on the same OSS buckets.
// With Wei's key every sample was transcribed back right and a headword got a clear pause. These voices read
// English only, so Chinese text (dictation prompts) goes to TTS_ZH_VOICE on TTS_MODEL. '+teacher' = the same voice
// with TTS_TEACHER as its instruction.
export const TTS_SPEECH_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
export const TTS_SPEECH_MODEL = 'qwen-audio-3.1-tts-flash';
export const TTS_SPEECH_VOICES = ['Ava_v3.1', 'Emily_v3.1', 'Brian_v3.1'];
export const TTS_ZH_VOICE = 'Cherry';
export const TTS_TEACHER = '用清楚、稍慢、温和的老师语气朗读，适合初中生跟读';
export const TTS_VOICES = [['Ava_v3.1', '美式女声（推荐）'], ['Ava_v3.1+teacher', '美式女声，老师语气'], ['Emily_v3.1', '英式女声'],
  ['Brian_v3.1', '美式男声'], ['Jennifer', '旧 · 美式女声'], ['Aiden', '旧 · 美式男声'], ['Cherry', '旧 · 女声，中英文都自然']];
// the default before v0.1.6: saved settings holding it and no voiceChosen flag count as never picked (db.js loadSettings)
export const OLD_DEFAULT_VOICE = 'Jennifer';
export const TTS_CHUNK = 500;          // characters per request (the API takes up to 600; a Chinese character counts 2)
export const TTS_TEXT_CAP = 3000;      // longest text read aloud in one tap (a reading passage)
export const TTS_TIMEOUT_MS = 15000;
export const TTS_CACHE = { clips: 2000, bytes: 150 * 1024 * 1024 };
