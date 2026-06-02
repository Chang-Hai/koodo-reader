import toast from "react-hot-toast";
import {
  ConfigService,
  KookitConfig,
  ReaderRequest,
  TokenService,
} from "../../assets/lib/kookit-extra-browser.min";
import localforage from "localforage";
import i18n from "../../i18n";
import { chatStream, handleExitApp } from "./common";
import {
  getServerRegion,
  getWebsiteUrl,
  openExternalUrl,
  openInBrowser,
  vexComfirmAsync,
} from "../common";
import { getTempToken } from "./user";
import { isSelfHostedWebProUnlocked } from "../selfHostedWebUnlock";
let readerRequest: ReaderRequest | undefined;
let isShowingQuotaAlert = false;
let quotaAlertDismissTime = 0;
const MAX_TRANSLATION_CACHE_ENTRIES = 5000;

type BatchTranslationCacheEntry = {
  text: string;
  normalizedText?: string;
  translatedText: string;
  updatedAt: number;
};

type BatchTranslationCache = Record<string, BatchTranslationCacheEntry>;
const batchTranslationMemoryCache = new Map<string, BatchTranslationCache>();

const hashText = (text: string) => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36) + "-" + text.length.toString(36);
};

const normalizeBatchTransText = (text: string) => {
  return (text || "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const getBatchTransTranslatorSignature = () => {
  if (!isSelfHostedWebProUnlocked()) {
    return "official-ai-trans";
  }

  const modelKey = ConfigService.getReaderConfig("aiTranslateModel") || "";
  const config = getCustomAiTranslateConfig() || {};
  const prompt =
    ConfigService.getReaderConfig("aiTranslatePrompt") ||
    KookitConfig.DefaultPrompts.aiTranslate ||
    "";
  return JSON.stringify({
    type: "custom-ai-trans",
    modelKey,
    endpoint: config.endpoint || "",
    providerId: config.providerId || "",
    modelId: config.modelId || "",
    promptHash: hashText(prompt),
  });
};

const getBatchTransCacheKey = (bookKey: string, from: string, to: string) => {
  return [
    "batchTransCache",
    "v1",
    bookKey,
    hashText(from || "Automatic"),
    hashText(to || ""),
    hashText(getBatchTransTranslatorSignature()),
  ].join(":");
};

const pruneBatchTransCache = (cache: BatchTranslationCache) => {
  const entries = Object.entries(cache);
  if (entries.length <= MAX_TRANSLATION_CACHE_ENTRIES) return cache;

  return Object.fromEntries(
    entries
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_TRANSLATION_CACHE_ENTRIES)
  );
};

const extractJsonArray = (content: string): string[] | null => {
  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1] : content;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : null;
  } catch (error) {
    console.error("Failed to parse AI batch translation result:", error);
    return null;
  }
};

const getCustomAiTranslateConfig = () => {
  const modelKey = ConfigService.getReaderConfig("aiTranslateModel");
  if (!modelKey) {
    return null;
  }

  const entry = ConfigService.getObjectConfig(modelKey, "aiModelConfig", null);
  return entry?.config || null;
};

const getCustomAiBatchTrans = async (
  texts: string[],
  from: string,
  to: string
) => {
  const config = getCustomAiTranslateConfig();
  if (!config?.endpoint || !config?.apiKey || !config?.modelId) {
    toast.error(
      i18n.t("Please configure an AI translation model in Settings - AI Service")
    );
    return { code: 400, msg: "missing custom ai translation model", data: null };
  }

  const prompt =
    `Translate each item in the JSON array from ${from || "Automatic"} to ${to}. ` +
    "Return only a valid JSON array of strings with the same length and order. " +
    "Do not return markdown, explanations, object wrappers, numbering, or extra keys. " +
    "Preserve HTML tags, punctuation, whitespace, names, numbers, and placeholders where possible.\n\n" +
    JSON.stringify(texts);

  let translatedText = "";
  await chatStream(
    config.endpoint,
    config.providerId,
    config.apiKey,
    config.modelId,
    prompt,
    [],
    (result) => {
      if (result?.text) {
        translatedText += result.text;
      }
    }
  );

  const parsedTexts = extractJsonArray(translatedText);
  if (!parsedTexts || parsedTexts.length !== texts.length) {
    toast.error(i18n.t("Translation failed") + ": invalid AI response");
    return { code: 400, msg: "invalid ai response", data: null };
  }

  return { code: 200, msg: "success", data: { texts: parsedTexts } };
};

export const getTransStream = async (
  text: string,
  from: string,
  to: string,
  onMessage: (result) => void
) => {
  let readerRequest = await getReaderRequest();
  let result = await readerRequest.getTransFetch(
    {
      text,
      from,
      to,
    },
    onMessage
  );
  return result;
};
export const getAnswerStream = async (
  text: string,
  question: string,
  history: any[],
  mode: string,
  onMessage: (result) => void
) => {
  let readerRequest = await getReaderRequest();
  let result = await readerRequest.getAnswerFetch(
    {
      text,
      question,
      history,
      mode,
    },
    onMessage
  );
  return result;
};
export const getDictionaryStream = async (
  word: string,
  from: string,
  to: string,
  sentence: string,
  isFullAnalysis: boolean,
  onMessage: (result) => void
) => {
  let readerRequest = await getReaderRequest();
  let result = await readerRequest.getDictionaryFetch(
    {
      word,
      from,
      to,
      sentence,
      is_full_analysis: isFullAnalysis,
    },
    onMessage
  );
  return result;
};
export const getDictionary = async (word: string, from: string, to: string) => {
  let readerRequest = await getReaderRequest();
  let response = await readerRequest.getDictionary({ word, from, to });
  if (response.code === 200) {
    return response;
  } else if (response.code === 401) {
    handleExitApp();
    return;
  } else {
    toast.error(i18n.t("Fetch failed, error code") + ": " + response.msg);
  }
  return response;
};
export const getReaderRequest = async () => {
  if (readerRequest) {
    return readerRequest;
  }
  readerRequest = new ReaderRequest(
    TokenService,
    ConfigService,
    getServerRegion()
  );
  return readerRequest;
};
export const resetReaderRequest = () => {
  readerRequest = undefined;
};
export const getDictText = async (word: string, from: string, to: string) => {
  if (from === "en") {
    from = "eng";
  }
  let res = await getDictionary(word, from, to);
  if (res.code === 200 && res.data && res.data.length > 0) {
    let dictText =
      `<p class="dict-word-type">[${i18n.t("Pronunciations")}]</p>` +
      (res.data[0].pronunciation ? res.data[0].pronunciation : "") +
      (res.data[0].audio &&
        `<div class="audio-container"><audio controls preload="auto"    class="audio-player" controlsList="nodownload noplaybackrate"><source src="${res.data[0].audio}" type="audio/mpeg"></audio></div>`) +
      (res.data[0].form
        ? `<p class="dict-word-type">[${i18n.t("Inflection")}]</p>`
        : "") +
      (res.data[0].form
        ? Array.from(new Set(res.data[0].form)).join(", ")
        : "") +
      res.data[0].meaning
        .map((item) => {
          return (
            (item.type && `<p><p class="dict-word-type">[${item.type}]</p>`) +
            `<div  style="font-weight: bold">${
              item.definition
            }</div><div>${item.examples
              .map((item) => {
                return `<p>${item.sentence}</p>` + `<p>${item.translation}</p>`;
              })
              .join("</div><div>")}</div></p>`
          );
        })
        .join("") +
      (res.data[0].comparison
        ? `<p class="dict-word-type">[${i18n.t("Word comparison")}]</p>`
        : "") +
      (res.data[0].comparison
        ? res.data[0].comparison.map(
            (item) =>
              `<p class="dict-learn-more">${item.word_to_compare}: </p>${item.analysis}`
          )
        : "") +
      `<p class="dict-learn-more">${i18n.t("Generated with AI")}</p>`;
    return dictText;
  } else {
    return "";
  }
};
export const getOcrResult = async (imageBase64: string, lang: string) => {
  let readerRequest = await getReaderRequest();
  let response = await readerRequest.getOcrResult({
    image_base64: imageBase64,
    lang,
  });
  if (response.code === 200) {
    return response;
  } else if (response.code === 401) {
    handleExitApp();
    return;
  } else {
    toast.error(i18n.t("Fetch failed, error code") + ": " + response.msg);
  }
  return response;
};
export const getTTSAudio = async (
  text: string,
  language: string,
  voice: string,
  speed: number,
  pitch: number,
  isFirst: boolean
) => {
  let readerRequest = await getReaderRequest();
  let response = await readerRequest.getTTSAudio({
    text,
    language,
    voice,
    speed,
    pitch,
    is_first: isFirst,
  });
  if (response.code === 200) {
    return response;
  } else if (response.code === 401) {
    handleExitApp();
    return;
  } else if (response.code === 20009) {
    const now = Date.now();
    const timeSinceDismiss = now - quotaAlertDismissTime;

    if (!isShowingQuotaAlert && timeSinceDismiss >= 10000 && response.data) {
      isShowingQuotaAlert = true;
      if (isSelfHostedWebProUnlocked()) {
        toast.error(
          i18n.t(
            "You have exhausted your daily free AI voice character quota. Please purchase more quota to continue using this feature or wait until the quota resets. You can also use other TTS voices instead."
          ) +
            " " +
            (response.data && response.data.ttl
              ? i18n.t("Your quota will be reset in", {
                  ttl: (response.data.ttl / 3600).toFixed(1),
                })
              : "")
        );
        isShowingQuotaAlert = false;
        quotaAlertDismissTime = Date.now();
      } else if (response.data.user_type === "pro") {
        let result = await vexComfirmAsync(
          i18n.t(
            "You have exhausted your daily free AI voice character quota. Please purchase more quota to continue using this feature or wait until the quota resets. You can also use other TTS voices instead."
          ) +
            " " +
            (response.data && response.data.ttl
              ? i18n.t("Your quota will be reset in", {
                  ttl: (response.data.ttl / 3600).toFixed(1),
                })
              : ""),
          "Purchase more quota"
        );
        if (result) {
          isShowingQuotaAlert = false;
          quotaAlertDismissTime = Date.now();
          openExternalUrl(
            getWebsiteUrl() +
              (ConfigService.getReaderConfig("lang").startsWith("zh")
                ? "/zh"
                : "/en") +
              "/tts-quota"
          );
        } else {
          isShowingQuotaAlert = false;
          quotaAlertDismissTime = Date.now();
        }
      } else {
        let result = await vexComfirmAsync(
          i18n.t(
            "Please upgrade to Pro to unlock more daily free quota or wait until the quota resets. You can also use other TTS voices instead."
          ) +
            " " +
            (response.data && response.data.ttl
              ? i18n.t("Your quota will be reset in", {
                  ttl: (response.data.ttl / 3600).toFixed(1),
                })
              : ""),
          "Upgrade to Pro"
        );
        if (result) {
          isShowingQuotaAlert = false;
          quotaAlertDismissTime = Date.now();
          let response = await getTempToken();
          if (response.code === 200) {
            let tempToken = response.data.access_token;
            let deviceUuid = await TokenService.getFingerprint();
            openInBrowser(
              getWebsiteUrl() +
                (ConfigService.getReaderConfig("lang").startsWith("zh")
                  ? "/zh"
                  : "/en") +
                "/pricing?temp_token=" +
                tempToken +
                "&device_uuid=" +
                deviceUuid
            );
          }
        } else {
          isShowingQuotaAlert = false;
          quotaAlertDismissTime = Date.now();
        }
      }
    }
    return response;
  } else {
    toast.error(i18n.t("Fetch failed, error code") + ": " + response.msg);
  }
  return null;
};
const getBatchTransFromNetwork = async (
  texts: string[],
  from: string,
  to: string
) => {
  if (isSelfHostedWebProUnlocked()) {
    try {
      return await getCustomAiBatchTrans(texts, from, to);
    } catch (error) {
      console.error(error);
      toast.error(
        i18n.t("Translation failed") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
      return { code: 500, msg: String(error), data: null };
    }
  }

  let readerRequest = await getReaderRequest();
  let response = await readerRequest.getBatchTrans({
    texts,
    from,
    to,
  });
  if (response.code === 200) {
    return response;
  } else if (response.code === 401) {
    handleExitApp();
    return;
  } else {
    toast.error(i18n.t("Fetch failed, error code") + ": " + response.msg);
  }
  return response;
};

export const getBatchTrans = async (
  texts: string[],
  from: string,
  to: string,
  options?: { bookKey?: string }
) => {
  const normalizedTexts = texts.map((text) => text || "");
  if (normalizedTexts.every((text) => !text.trim())) {
    return { code: 200, msg: "success", data: { texts: normalizedTexts } };
  }

  if (!options?.bookKey) {
    return getBatchTransFromNetwork(normalizedTexts, from, to);
  }

  const cacheKey = getBatchTransCacheKey(options.bookKey, from, to);
  const cache =
    batchTranslationMemoryCache.get(cacheKey) ||
    ((await localforage.getItem(cacheKey)) as BatchTranslationCache | null) ||
    {};
  batchTranslationMemoryCache.set(cacheKey, cache);
  const translatedTexts = new Array<string | null>(normalizedTexts.length).fill(
    null
  );
  const missingTexts: string[] = [];
  const missingTextIndexes = new Map<string, number[]>();

  normalizedTexts.forEach((text, index) => {
    if (!text.trim()) {
      translatedTexts[index] = text;
      return;
    }

    const normalizedText = normalizeBatchTransText(text);
    const textHash = hashText(normalizedText);
    const cached = cache[textHash];
    const cachedNormalizedText =
      cached && (cached.normalizedText || normalizeBatchTransText(cached.text));
    if (
      cached &&
      cachedNormalizedText === normalizedText &&
      cached.translatedText
    ) {
      translatedTexts[index] = cached.translatedText;
      cached.updatedAt = Date.now();
      return;
    }

    if (!missingTextIndexes.has(normalizedText)) {
      missingTextIndexes.set(normalizedText, []);
      missingTexts.push(text);
    }
    missingTextIndexes.get(normalizedText)!.push(index);
  });

  if (missingTexts.length === 0) {
    const prunedCache = pruneBatchTransCache(cache);
    batchTranslationMemoryCache.set(cacheKey, prunedCache);
    await localforage.setItem(cacheKey, prunedCache);
    return {
      code: 200,
      msg: "success",
      data: { texts: translatedTexts as string[] },
    };
  }

  const response = await getBatchTransFromNetwork(missingTexts, from, to);
  if (!response || response.code !== 200 || !response.data?.texts) {
    return response;
  }

  response.data.texts.forEach((translatedText: string, index: number) => {
    const sourceText = missingTexts[index];
    const normalizedSourceText = normalizeBatchTransText(sourceText);
    const targetIndexes = missingTextIndexes.get(normalizedSourceText) || [];
    targetIndexes.forEach((targetIndex) => {
      translatedTexts[targetIndex] = translatedText;
    });
    cache[hashText(normalizedSourceText)] = {
      text: sourceText,
      normalizedText: normalizedSourceText,
      translatedText,
      updatedAt: Date.now(),
    };
  });

  normalizedTexts.forEach((text, index) => {
    if (translatedTexts[index] === null) {
      translatedTexts[index] = text;
    }
  });

  const prunedCache = pruneBatchTransCache(cache);
  batchTranslationMemoryCache.set(cacheKey, prunedCache);
  await localforage.setItem(cacheKey, prunedCache);
  return {
    code: 200,
    msg: "success",
    data: { texts: translatedTexts as string[] },
  };
};
export const getWordDefinitions = async (
  texts: string[],
  level: string,
  lang: string
) => {
  let readerRequest = await getReaderRequest();
  let response = await readerRequest.analyzeText({ texts, level, lang });
  if (response.code === 200) {
    return response;
  } else if (response.code === 401) {
    handleExitApp();
    return;
  } else {
    toast.error(i18n.t("Fetch failed, error code") + ": " + response.msg);
  }
  return response;
};
export const getBookMetadata = async (name: string, author: string) => {
  let readerRequest = await getReaderRequest();
  let response = await readerRequest.getBookMetadata({ name, author });
  if (response.code === 200) {
    return response;
  } else if (response.code === 401) {
    handleExitApp();
    return;
  } else {
    toast.error(i18n.t("Fetch failed, error code") + ": " + response.msg);
  }
  return response;
};
export const getSplitSentence = async (
  texts: { text: string; index: number }[]
) => {
  let readerRequest = await getReaderRequest();
  let response = await readerRequest.getSplitSentence({ texts });
  if (response.code === 200) {
    return response;
  } else if (response.code === 401) {
    handleExitApp();
    return response;
  } else if (response.code === 20009) {
    toast.error(
      i18n.t("You have reached the daily limit for this feature.") +
        " " +
        i18n.t("AI multi-role speech is paused for now.") +
        " " +
        i18n.t("Your quota will be reset in", {
          ttl:
            response.data && response.data.ttl
              ? (response.data.ttl / 3600).toFixed(1)
              : "",
        })
    );
  } else {
    toast.error(i18n.t("Fetch failed, error code") + ": " + response.msg);
  }
  return response;
};
export const detectLanguage = async (text: string) => {
  let readerRequest = await getReaderRequest();
  let response = await readerRequest.detectLanguage({ text });
  if (response.code === 200) {
    return response;
  } else if (response.code === 401) {
    handleExitApp();
    return;
  } else {
    toast.error(i18n.t("Fetch failed, error code") + ": " + response.msg);
  }
  return null;
};
