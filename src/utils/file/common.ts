import { prepareThirdConfig } from "../common";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../storage/databaseService";
import localforage from "localforage";
import Book from "../../models/Book";
import Note from "../../models/Note";
import Bookmark from "../../models/Bookmark";
import DictHistory from "../../models/DictHistory";
import { decryptToken } from "../request/thirdparty";
import toast from "react-hot-toast";
import i18n from "../../i18n";

// File System Access API type declarations

let configCache: any = {};
let cloudConfigLocks: { [service: string]: Promise<any> } = {};
export const changePath = async (newPath: string) => {
  toast.error(i18n.t("Koodo Reader's web version are limited by the browser"));
  return false;
};
export const changeLibrary = async (newPath: string) => {
  toast.error(i18n.t("Koodo Reader's web version are limited by the browser"));
  return false;
};
const isFolderContainsFile = (folderPath: string) => {
  return false;
};
const isKoodoLibrary = (folderPath: string) => {
  return false;
};
export const getLastSyncTimeFromConfigJson = () => {
  return parseInt(ConfigService.getItem("lastSyncTime") || "0");
};
export function getParamsFromUrl() {
  var hashParams: any = {};
  var e,
    r = /([^&;=]+)=?([^&;]*)/g,
    q = window.location.search.substring(1).split("#")[0];
  while ((e = r.exec(q))) {
    hashParams[e[1]] = decodeURIComponent(e[2]);
  }
  return hashParams;
}
export function getLoginParamsFromUrl() {
  const url = document.location.href;
  const params = {};
  const queryString = url.split("?")[1];
  const regex = /([^&;=]+)=?([^&;]*)/g;
  let match;

  while ((match = regex.exec(queryString))) {
    params[decodeURIComponent(match[1])] = decodeURIComponent(match[2]);
  }

  return params;
}
export const upgradeStorage = async (
  handleFinish: () => void = () => {}
): Promise<Boolean> => {
  try {
    if (ConfigService.getItem("isUpgradedStorage") === "yes") {
      return true;
    }

    let books: Book[] | null = await localforage.getItem("books");
    if (books && books.length > 0) {
      for (let i = 0; i < books.length; i++) {
        if (typeof books[i].author !== "string") {
          books[i].author = "";
        }
      }
      await DatabaseService.saveAllRecords(books, "books");
    }

    let plugins =
      ConfigService.getItem("pluginList") !== "{}" &&
      ConfigService.getItem("pluginList")
        ? JSON.parse(ConfigService.getItem("pluginList") || "")
        : [];
    if (plugins.length > 0) {
      plugins = plugins.map((item: any) => {
        if (!item.key) {
          item.key = item.identifier;
        }
        return item;
      });
      await DatabaseService.saveAllRecords(plugins, "plugins");
    }

    //upgrade notes
    let notes: Note[] | null = await localforage.getItem("notes");
    if (notes && notes.length > 0) {
      await DatabaseService.saveAllRecords(notes, "notes");
    }

    //upgrade bookmarks
    let bookmarks: Bookmark[] | null = await localforage.getItem("bookmarks");
    if (bookmarks && bookmarks.length > 0) {
      await DatabaseService.saveAllRecords(bookmarks, "bookmarks");
    }
    //upgrade words
    let words: DictHistory[] | null = await localforage.getItem("words");
    if (words && words.length > 0) {
      await DatabaseService.saveAllRecords(words, "words");
    }

    ConfigService.setItem("isUpgradedStorage", "yes");
    handleFinish();
    return true;
  } catch (error) {
    console.error(error);
    handleFinish();
    return false;
  }
};
export const upgradeConfig = (): Boolean => {
  try {
    if (ConfigService.getItem("isUpgradedConfig") === "yes") {
      return true;
    }
    //upgrade shelf

    let shelfList = ConfigService.getAllMapConfig("shelfList");
    if ("New" in shelfList) {
      ConfigService.deleteMapConfig("New", "shelfList");
    }
    let sortedShelfList =
      ConfigService.getAllListConfig("sortedShelfList") || [];
    if (sortedShelfList.length === 0) {
      ConfigService.setAllListConfig(
        Object.keys(shelfList).filter((item) => item !== "New"),
        "sortedShelfList"
      );
    }

    //upgrade noteSortCode
    let json = ConfigService.getItem("noteSortCode");
    if (json) {
      ConfigService.setReaderConfig("noteSortCode", json);
    }

    //upgrade bookSortCode
    json = ConfigService.getItem("bookSortCode");
    if (json) {
      ConfigService.setReaderConfig("bookSortCode", json);
    }

    //remove dropbox token
    ConfigService.setReaderConfig("dropbox_token", "");

    ConfigService.setItem("isUpgradedConfig", "yes");
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};
export const getCloudConfig = (service: string): Promise<any> => {
  const prev = cloudConfigLocks[service] ?? Promise.resolve();
  const next = prev.then(async () => {
    let config = await getCloudToken(service);
    if (!config) {
      return {};
    }
    return await prepareThirdConfig(service, config);
  });
  // 链上错误处理，避免一次失败阻断后续调用
  cloudConfigLocks[service] = next.catch(() => {});
  return next;
};
export const getCloudToken = async (service: string) => {
  if (configCache[service]) {
    return configCache[service];
  } else {
    let result = await decryptToken(service);
    if (result.code !== 200) {
      return null;
    }
    let config = JSON.parse(result.data.token);
    configCache[service] = config;
    return config;
  }
};
export const removeCloudConfig = (service: string) => {
  delete configCache[service];
};
