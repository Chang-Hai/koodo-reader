import {
  ConfigService,
  TokenService,
} from "../../assets/lib/kookit-extra-browser.min";
import localforage from "localforage";
import BookModel from "../../models/Book";
import toast from "react-hot-toast";
import { showDownloadProgress } from "../common";
import SyncService from "../storage/syncService";
import { CommonTool } from "../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../storage/databaseService";
import Book from "../../models/Book";
import i18n from "../../i18n";
import { getCloudConfig } from "./common";
import CoverUtil from "./coverUtil";
import { LocalFileManager } from "./localFile";
import {
  isSelfHostedOfflineFirst,
  shouldTreatSelfHostedWebAsAuthed,
} from "../selfHostedWebUnlock";

class BookUtil {
  static async addBook(key: string, format: string, buffer: ArrayBuffer) {
    // for both original books and cached boks
    if (!isSelfHostedOfflineFirst() && ConfigService.getItem("defaultSyncOption")) {
      toast.loading(i18n.t("Uploading book"), {
        id: "add-book",
      });
    }
    if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
      await LocalFileManager.saveFile(key + "." + format, buffer, "book");
    } else {
      await localforage.setItem(key, buffer);
    }
    await this.uploadBook(key, format);
  }
  static deleteBook(key: string, format: string) {
    try {
      this.deleteCloudBook(key, format);
      if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
        return LocalFileManager.deleteFile(key + "." + format, "book");
      } else {
        return localforage.removeItem(key);
      }
    } catch (error) {
      console.error("delete book error:", error);
    }
  }
  static isBookExist(key: string, format: string, bookPath: string) {
    return new Promise<boolean>((resolve) => {
      if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
        LocalFileManager.fileExists(key + "." + format, "book").then(
          (exists) => {
            resolve(exists);
          }
        );
      } else {
        localforage.getItem(key).then((result) => {
          resolve(!!result);
        });
      }
    });
  }
  static fetchBook(
    key: string,
    format: string,
    isArrayBuffer: boolean = false,
    bookPath: string
  ) {
    if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
      return LocalFileManager.readFile(
        key + "." + format,
        "book"
      ) as Promise<ArrayBuffer>;
    } else {
      return localforage.getItem(key) as Promise<ArrayBuffer>;
    }
  }
  static getBookPath(book: Book) {
    return "";
  }
  static fetchAllBooks(Books: BookModel[]) {
    return Books.map((item) => {
      return this.fetchBook(
        item.key,
        item.format.toLowerCase(),
        true,
        item.path
      );
    });
  }
  static async redirectBook(book: BookModel) {
    if (
      !(await this.isBookExist(
        book.key,
        book.format.toLowerCase(),
        book.path
      )) &&
      !(await this.isBookExist("cache-" + book.key, "zip", book.path))
    ) {
      if (isSelfHostedOfflineFirst() || !ConfigService.getItem("defaultSyncOption")) {
        toast(i18n.t("Please add data source in the setting"));
        return;
      }
      toast.loading(i18n.t("Downloading"), {
        id: "offline-book",
      });
      if (
        shouldTreatSelfHostedWebAsAuthed(
          (await TokenService.getToken("is_authed")) === "yes"
        ) &&
        (await this.isBookExistInCloud(book.key))
      ) {
        let timer = showDownloadProgress(
          ConfigService.getItem("defaultSyncOption") || "",
          "cloud",
          book.size
        );
        let result = await this.downloadBook(book.key, book.format);
        clearInterval(timer);
        toast.dismiss("offline-book");

        let covers = await CoverUtil.getCloudCoverList();
        for (let cover of covers) {
          if (cover.startsWith(book.key)) {
            await CoverUtil.downloadCover(cover);
          }
        }

        if (result) {
          toast.success(i18n.t("Download successful"), {
            id: "offline-book",
          });
        } else {
          let result = await this.downloadCacheBook(book.key);
          if (result) {
            toast.success(i18n.t("Download successful"), {
              id: "offline-book",
            });
          } else {
            toast.error(i18n.t("Download failed"), {
              id: "offline-book",
            });
            if (ConfigService.getItem("defaultSyncOption") === "adrive") {
              toast.error(
                i18n.t(
                  "Aliyun Drive imposes strict limits on concurrent downloads. It is recommended that you wait 10 seconds before attempting to download again."
                ),
                {
                  id: "offline-book",
                }
              );
            }
            return;
          }
        }
      } else {
        toast.error(i18n.t("Book not exists"), {
          id: "offline-book",
        });
        return;
      }
    }
    let ref = book.format.toLowerCase();

    window.open(
      `${window.location.href.split("#")[0]}#/${ref}/${book.key}?title=${
        book.name
      }&file=${book.key}`
    );
  }
  static getBookUrl(book: BookModel) {
    let ref = book.format.toLowerCase();
    return `/${ref}/${book.key}`;
  }
  static reloadBooks(currentBook: BookModel) {
    window.location.reload();
  }
  static async isBookExistInCloud(key: string) {
    let service = ConfigService.getItem("defaultSyncOption");
    if (isSelfHostedOfflineFirst() || !service) {
      return false;
    }
    let syncUtil = await SyncService.getSyncUtil();
    return await syncUtil.isExist(key, "book");
  }
  static async downloadCacheBook(key: string) {
    let service = ConfigService.getItem("defaultSyncOption");
    if (isSelfHostedOfflineFirst() || !service) {
      return false;
    }
    let syncUtil = await SyncService.getSyncUtil();
    let cache = await syncUtil.downloadFile("cache-" + key + ".zip", "book");
    if (!cache) {
      console.error("download cache failed");
      return false;
    }
    await this.addBook("cache-" + key, "zip", cache);
    toast.dismiss("add-book");
    return true;
  }
  static async downloadBook(key: string, format: string) {
    let service = ConfigService.getItem("defaultSyncOption");
    if (isSelfHostedOfflineFirst() || !service) {
      return;
    }
    let syncUtil = await SyncService.getSyncUtil();
    let bookBuffer = await syncUtil.downloadFile(
      key + "." + format.toLowerCase(),
      "book"
    );
    if (!bookBuffer) {
      return false;
    }
    await this.addBook(key, format, bookBuffer);
    toast.dismiss("add-book");
    return true;
  }
  static async uploadBook(key: string, format: string) {
    if (isSelfHostedOfflineFirst() || key.startsWith("cache")) {
      return;
    }
    let isAuthed = await TokenService.getToken("is_authed");
    if (
      isSelfHostedOfflineFirst() ||
      !shouldTreatSelfHostedWebAsAuthed(isAuthed === "yes")
    ) {
      return;
    }
    let service = ConfigService.getItem("defaultSyncOption");
    if (isSelfHostedOfflineFirst() || !service) {
      return;
    }
    let syncUtil = await SyncService.getSyncUtil();
    let bookBuffer: any = await this.fetchBook(key, format, true, "");
    let bookBlob = new Blob([bookBuffer], {
      type: CommonTool.getMimeType(format.toLowerCase()),
    });
    let result = await syncUtil.uploadFile(
      key + "." + format.toLowerCase(),
      "book",
      bookBlob
    );
    if (!result) {
      toast.error(i18n.t("Upload failed"), {
        id: "upload-book",
      });
      return;
    }
  }
  static async deleteCloudBook(key: string, format: string) {
    let isAuthed = await TokenService.getToken("is_authed");
    if (
      isSelfHostedOfflineFirst() ||
      !shouldTreatSelfHostedWebAsAuthed(isAuthed === "yes")
    ) {
      return;
    }
    let service = ConfigService.getItem("defaultSyncOption");
    if (isSelfHostedOfflineFirst() || !service) {
      return;
    }
    let syncUtil = await SyncService.getSyncUtil();
    await syncUtil.deleteFile(key + "." + format.toLowerCase(), "book");
  }

  static async deleteCacheBook(key: string) {
    await this.deleteBook("cache-" + key, "zip");
  }
  static async offlineBook(key: string, format: string) {
    let result = await this.downloadBook(key, format);
    if (!result) {
      result = await this.downloadCacheBook(key);
    }
    return result;
  }
  static async deleteOfflineBook(key: string) {
    let book: Book = await DatabaseService.getRecord(key, "books");
    if (!book) {
      return;
    }
    await this.deleteBook(key, book.format.toLowerCase());
    await this.deleteCacheBook(key);
    await CoverUtil.deleteOfflineCover(key);
  }
  static async isBookOffline(key: string) {
    let book: Book = await DatabaseService.getRecord(key, "books");
    return await this.isBookExist(key, book.format.toLowerCase(), book.path);
  }
  static async getLocalBookList() {
    let books: Book[] = (await DatabaseService.getAllRecords("books")) || [];
    let fileList: string[] = [];
    for (let book of books) {
      if (await this.isBookExist(book.key, book.format.toLowerCase(), "")) {
        fileList.push(book.key + "." + book.format.toLowerCase());
      }
      if (await this.isBookExist("cache-" + book.key, "zip", "")) {
        fileList.push("cache-" + book.key + ".zip");
      }
    }
    return fileList;
  }
  static async getCloudBookList() {
    let service = ConfigService.getItem("defaultSyncOption");
    if (isSelfHostedOfflineFirst() || !service) {
      return [];
    }
    let syncUtil = await SyncService.getSyncUtil();
    let cloudBookList = await syncUtil.listFiles("book");
    return cloudBookList;
  }
  static async getBookNamesMapByKeys(bookKeys: string[]) {
    if (bookKeys.length === 0) {
      return {};
    }
    let books: Book[] = (await DatabaseService.getAllRecords("books")) || [];
    let map: { [key: string]: string } = {};
    for (let book of books) {
      if (bookKeys.includes(book.key)) {
        map[book.key] = book.name;
      }
    }
    return map;
  }
  static async getBookKeysWithSort(sortField: string, orderField: string) {
    let books: Book[] = (await DatabaseService.getAllRecords("books")) || [];
    if (sortField === "name") {
      books.sort((a, b) => {
        const comparison = a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return orderField === "ASC" ? comparison : -comparison;
      });
      return books.map((item) => {
        return { key: item.key };
      });
    } else if (sortField === "author") {
      books.sort((a, b) => {
        const comparison = a.author.localeCompare(b.author, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return orderField === "ASC" ? comparison : -comparison;
      });
      return books.map((item) => {
        return { key: item.key };
      });
    } else if (sortField === "key") {
      if (orderField === "DESC") {
        books = books.reverse();
      }
      return books.map((item) => {
        return { key: item.key };
      });
    } else {
      books.sort((a, b) => {
        const comparison =
          ((a as any)[sortField] || 0) - ((b as any)[sortField] || 0);
        return orderField === "ASC" ? comparison : -comparison;
      });
      return books.map((item) => {
        return { key: item.key };
      });
    }
  }
  static async getBookByMd5(md5: string) {
    let books: Book[] = (await DatabaseService.getAllRecords("books")) || [];
    for (let book of books) {
      if (book.md5 === md5) {
        return book;
      }
    }
    return null;
  }
  static async searchBooksByKeyword(keyword: string) {
    let books: Book[] = (await DatabaseService.getAllRecords("books")) || [];
    let results: Book[] = [];
    const lowerKeyword = keyword.toLowerCase();
    for (let book of books) {
      if (
        book.name.toLowerCase().includes(lowerKeyword) ||
        book.author.toLowerCase().includes(lowerKeyword)
      ) {
        results.push(book);
      }
    }
    return results;
  }
  static async getBookList() {
    let books: Book[] = (await DatabaseService.getAllRecords("books")) || [];
    return books;
  }
}

export default BookUtil;
