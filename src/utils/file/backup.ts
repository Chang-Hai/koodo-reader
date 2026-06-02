import BookUtil from "./bookUtil";
import { checkMissingBook } from "../common";
import CoverUtil from "./coverUtil";
import {
  CommonTool,
  ConfigService,
} from "../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../storage/databaseService";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import ConfigUtil from "./configUtil";
import SyncService from "../storage/syncService";
import BackgroundUtil from "./backgroundUtil";
import toast from "react-hot-toast";
import i18n from "../../i18n";

export const backup = async (service: string): Promise<Boolean> => {
  await checkMissingBook();
  let fileName = "data.zip";
  if (service === "local") {
    let year = new Date().getFullYear(),
      month = new Date().getMonth() + 1,
      day = new Date().getDate();
    fileName = `${year}-${month <= 9 ? "0" + month : month}-${
      day <= 9 ? "0" + day : day
    }.zip`;
  }
  let blob: Blob | boolean = await backupFromStorage();
  if (!blob) {
    return false;
  }
  if (service === "local") {
    saveAs(blob as Blob, fileName);
    return true;
  } else {
    let syncUtil = await SyncService.getSyncUtil();
    let result = await syncUtil.uploadFile(fileName, "backup", blob as Blob);
    if (result) {
      return true;
    } else {
      return false;
    }
  }
};
export const generateSnapshot = async () => {
  return;
};
export const getSnapshots = () => {
  return [];
};
export const backupFromPath = async (
  targetPath: string,
  fileName: string,
  onProgress?: (percent: number) => void
) => {
  return false;
};
export const backupFromStorage = async () => {
  let zip = new JSZip();
  let books = await DatabaseService.getDbBuffer("books");
  let notes = await DatabaseService.getDbBuffer("notes");
  let bookmarks = await DatabaseService.getDbBuffer("bookmarks");
  let words = await DatabaseService.getDbBuffer("words");
  let plugins = await DatabaseService.getDbBuffer("plugins");
  let config = JSON.stringify(await ConfigUtil.dumpConfig("config"));
  let sync = JSON.stringify(await ConfigUtil.dumpConfig("sync"));
  await zipCover(zip);
  await zipBook(zip);
  await zipBackground(zip);
  let result = await zipConfig(
    zip,
    books,
    notes,
    bookmarks,
    words,
    plugins,
    config,
    sync
  );
  if (!result) return false;
  return await zip.generateAsync({ type: "blob" });
};

export const backupToConfigJson = async () => {
  return JSON.stringify(await ConfigUtil.dumpConfig("config"));
};
export const backupToSyncJson = async () => {
  return JSON.stringify(await ConfigUtil.dumpConfig("sync"));
};

export const zipBook = (zip: any) => {
  return new Promise<boolean>(async (resolve) => {
    let books = await DatabaseService.getAllRecords("books");
    let bookZip = zip.folder("book");
    let data: any = [];
    books &&
      books.forEach((item) => {
        data.push(
          BookUtil.fetchBook(
            item.key,
            item.format.toLowerCase(),
            false,
            item.path
          )
        );
      });
    try {
      let results = await Promise.all(data);
      for (let i = 0; i < books.length; i++) {
        results[i] &&
          bookZip.file(
            `${books[i].key}.${books[i].format.toLocaleLowerCase()}`,
            results[i]
          );
      }
      resolve(true);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(errorMessage);
      resolve(false);
    }
  });
};
export const zipCover = async (zip: any) => {
  let books = await DatabaseService.getAllRecords("books");
  let coverZip = zip.folder("cover");
  for (let i = 0; i < books.length; i++) {
    let cover = await CoverUtil.getCover(books[i]);
    const result = await CoverUtil.convertCoverBase64(cover);
    coverZip.file(`${books[i].key}.${result.extension}`, result.arrayBuffer);
  }
};

export const zipBackground = async (zip: any) => {
  const backgroundIds = ConfigService.getAllListConfig("backgroundList") || [];
  const bgZip = zip.folder("background");
  for (const id of backgroundIds) {
    const meta = BackgroundUtil.getImageMeta(id);
    if (!meta) continue;
    try {
      const dataUrl = await BackgroundUtil.loadImage(id, meta.extension);
      if (!dataUrl) continue;
      const { arrayBuffer, extension } = BackgroundUtil.convertDataUrl(dataUrl);
      bgZip.file(`${id}.${extension}`, arrayBuffer);
    } catch (error) {
      console.error(`Failed to backup background ${id}:`, error);
    }
  }
};

export const zipConfig = (
  zip: any,
  bookBuffer: ArrayBuffer,
  noteBuffer: ArrayBuffer,
  bookmarkBuffer: ArrayBuffer,
  wordBuffer: ArrayBuffer,
  pluginBuffer: ArrayBuffer,
  config: string,
  sync: string
) => {
  return new Promise<boolean>((resolve) => {
    try {
      let configZip = zip.folder("config");
      configZip
        .file("notes.db", noteBuffer)
        .file("books.db", bookBuffer)
        .file("bookmarks.db", bookmarkBuffer)
        .file("words.db", wordBuffer)
        .file("plugins.db", pluginBuffer)
        .file("config.json", config)
        .file("sync.json", sync);
      resolve(true);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(errorMessage);
      resolve(false);
    }
  });
};
