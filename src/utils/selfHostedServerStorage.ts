import {
  ConfigService,
} from "../assets/lib/kookit-extra-browser.min";
import { encryptToken } from "./request/thirdparty";
import {
  isSelfHostedOfflineFirst,
  isSelfHostedServerStorageEnabled,
  isSelfHostedWebProUnlocked,
} from "./selfHostedWebUnlock";
import SyncService from "./storage/syncService";
import { removeCloudConfig } from "./file/common";

type SelfHostedStorageConfig = {
  enabled?: boolean;
  service?: "webdav";
  url?: string;
  dir?: string;
  username?: string;
  password?: string;
  version?: string | number;
};

const CONFIG_FILE = "self-hosted-storage.json";
const CONFIG_SIGNATURE_KEY = "selfHostedServerStorageSignature";

const getRuntimeConfigUrl = () => {
  if (typeof window === "undefined") {
    return CONFIG_FILE;
  }

  return new URL(CONFIG_FILE, window.location.origin + window.location.pathname)
    .href;
};

const getConfigSignature = (config: SelfHostedStorageConfig) =>
  JSON.stringify({
    service: config.service || "webdav",
    url: config.url || "",
    dir: config.dir || "",
    username: config.username || "",
    version: config.version || "",
  });

export const shouldSuppressSelfHostedLocalFolderPrompt = () =>
  isSelfHostedWebProUnlocked();

export const bootstrapSelfHostedServerStorage = async (): Promise<boolean> => {
  if (
    !isSelfHostedWebProUnlocked() ||
    isSelfHostedOfflineFirst() ||
    !isSelfHostedServerStorageEnabled() ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  ) {
    return false;
  }

  let config: SelfHostedStorageConfig | null = null;
  try {
    const response = await fetch(getRuntimeConfigUrl(), {
      cache: "no-store",
    });
    if (!response.ok) {
      return false;
    }
    config = await response.json();
  } catch (error) {
    console.warn("Self-hosted server storage config is unavailable:", error);
    return false;
  }

  if (
    !config?.enabled ||
    (config.service && config.service !== "webdav") ||
    !config.url ||
    !config.dir ||
    !config.username ||
    !config.password
  ) {
    console.warn("Self-hosted server storage config is incomplete.");
    return false;
  }

  const signature = getConfigSignature(config);
  const isAlreadyConfigured =
    ConfigService.getItem(CONFIG_SIGNATURE_KEY) === signature &&
    ConfigService.getItem("defaultSyncOption") === "webdav" &&
    ConfigService.getAllListConfig("dataSourceList").includes("webdav");

  if (isAlreadyConfigured) {
    return false;
  }

  const result = await encryptToken("webdav", {
    url: config.url,
    dir: config.dir,
    username: config.username,
    password: config.password,
  });

  if (result?.code !== 200) {
    return false;
  }

  ConfigService.setListConfig("webdav", "dataSourceList");
  ConfigService.setItem("defaultSyncOption", "webdav");
  ConfigService.setReaderConfig("isUseLocal", "no");
  ConfigService.setItem(CONFIG_SIGNATURE_KEY, signature);
  SyncService.removeSyncUtil("webdav");
  removeCloudConfig("webdav");

  return true;
};
