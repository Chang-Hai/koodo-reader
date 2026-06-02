const SELF_HOSTED_UNLOCK_META = "koodo-self-hosted-pro-unlock";
const SELF_HOSTED_OFFLINE_FIRST_META = "koodo-self-hosted-offline-first";
const SELF_HOSTED_SERVER_STORAGE_META = "koodo-self-hosted-server-storage";
const FAR_FUTURE_UNIX_SECONDS = 4102444800;

const SELF_HOSTED_UNLOCK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "193.134.211.106",
]);

export const isSelfHostedUnlockHost = (hostname: string): boolean => {
  return SELF_HOSTED_UNLOCK_HOSTS.has(hostname.trim().toLowerCase());
};

export const isSelfHostedWebProUnlocked = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const metaContent = document
    .querySelector(`meta[name="${SELF_HOSTED_UNLOCK_META}"]`)
    ?.getAttribute("content");

  if (metaContent === "true") {
    return true;
  }

  return isSelfHostedUnlockHost(window.location.hostname);
};

const getMetaContent = (name: string): string | null => {
  if (typeof document === "undefined") {
    return null;
  }

  return document
    .querySelector(`meta[name="${name}"]`)
    ?.getAttribute("content") ?? null;
};

export const isSelfHostedOfflineFirst = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  return getMetaContent(SELF_HOSTED_OFFLINE_FIRST_META) === "true";
};

export const isSelfHostedServerStorageEnabled = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  return getMetaContent(SELF_HOSTED_SERVER_STORAGE_META) === "true";
};

export const shouldTreatSelfHostedWebAsAuthed = (isAuthed: boolean): boolean => {
  return isAuthed || isSelfHostedWebProUnlocked();
};

export const buildSelfHostedUnlockedUserInfo = (
  userInfo: Record<string, any> | null = null,
  nowSeconds: number = Math.floor(Date.now() / 1000)
) => {
  if (!isSelfHostedWebProUnlocked()) {
    return userInfo;
  }

  return {
    ...(userInfo || {}),
    type: "pro",
    email: userInfo?.email || "self-hosted@local",
    nickname: userInfo?.nickname || "Self-hosted Web",
    valid_until: Math.max(
      userInfo?.valid_until || 0,
      nowSeconds + 86400,
      FAR_FUTURE_UNIX_SECONDS
    ),
    token_valid_until: Math.max(
      userInfo?.token_valid_until || 0,
      nowSeconds + 86400,
      FAR_FUTURE_UNIX_SECONDS
    ),
    free_credits:
      typeof userInfo?.free_credits === "number" ? userInfo.free_credits : 999999,
    tts_credits:
      typeof userInfo?.tts_credits === "number" ? userInfo.tts_credits : 999999,
    is_enable_koodo_sync: userInfo?.is_enable_koodo_sync || "no",
  };
};
