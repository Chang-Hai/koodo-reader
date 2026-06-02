import SyncService from "../storage/syncService";
import {
  ConfigService,
  CommonTool,
} from "../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../storage/databaseService";
import SqlUtil from "./sqlUtil";
import { getThirdpartyRequest } from "../request/thirdparty";
import { handleExitApp } from "../request/common";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import Note from "../../models/Note";

class ConfigUtil {
  public static syncData: any = {};
  public static updateData: any = {};
  static async downloadConfig(type: string) {
    let syncUtil = await SyncService.getSyncUtil();
    let jsonBuffer: ArrayBuffer = await syncUtil.downloadFile(
      type + ".json",
      "config"
    );
    if (!jsonBuffer) {
      return "{}";
    }
    let jsonStr = new TextDecoder().decode(jsonBuffer);
    return jsonStr;
  }
  static async uploadConfig(type: string) {
    let config = {};
    if (type === "sync") {
      config = ConfigService.getAllSyncRecord();
    } else {
      let configList = CommonTool.configList;
      for (let i = 0; i < configList.length; i++) {
        let item = configList[i];
        if (ConfigService.getItem(item)) {
          config[item] = ConfigService.getItem(item);
        }
      }
    }
    if (ConfigService.getReaderConfig("isEnableKoodoSync") === "yes") {
      this.updateData[type] = JSON.stringify(config);
      return;
    }
    let syncUtil = await SyncService.getSyncUtil();
    let configBlob = new Blob([JSON.stringify(config)], {
      type: "application/json",
    });
    await syncUtil.uploadFile(type + ".json", "config", configBlob);
  }
  static async getSyncData(type: string) {
    let defaultValue = type === "sync" || type === "config" ? "{}" : "[]";
    if (this.syncData[type]) {
      return JSON.parse(this.syncData[type] || defaultValue);
    }
    let thirdpartyRequest = await getThirdpartyRequest();

    let response = await thirdpartyRequest.getSyncDataByType({ type });
    if (response.code === 200) {
      this.syncData[type] = response.data;
      return JSON.parse(this.syncData[type] || defaultValue);
    } else if (response.code === 401) {
      handleExitApp();
      return null;
    } else {
      toast.error(
        i18n.t("Synchronization failed, error code") + ": " + response.msg
      );
      if (response.code === 20004) {
        toast(
          i18n.t("Please login again to update your membership on this device")
        );
      }
      return null;
    }
  }
  static async updateSyncData() {
    let thirdpartyRequest = await getThirdpartyRequest();

    let response = await thirdpartyRequest.updateSyncData(this.updateData);
    if (response.code === 200) {
    } else if (response.code === 401) {
      handleExitApp();
    } else {
      toast.error(
        i18n.t("Synchronization failed, error code") + ": " + response.msg
      );
      if (response.code === 20004) {
        toast(
          i18n.t("Please login again to update your membership on this device")
        );
      }
    }

    this.syncData = {};
    this.updateData = {};
  }
  static async getCloudConfig(type: string) {
    if (ConfigService.getReaderConfig("isEnableKoodoSync") === "yes") {
      let config = await this.getSyncData(type);
      return config || {};
    }
    let configStr = (await ConfigUtil.downloadConfig(type)) || "{}";
    return JSON.parse(configStr);
  }

  static async getCloudDatabase(database: string) {
    if (ConfigService.getReaderConfig("isEnableKoodoSync") === "yes") {
      let data = await this.getSyncData(database);
      return data || [];
    }
    let syncUtil = await SyncService.getSyncUtil();
    let dbBuffer = await syncUtil.downloadFile(database + ".db", "config");
    if (!dbBuffer) {
      return [];
    }
    let sqlUtil = new SqlUtil();
    let cloudRecords = await sqlUtil.dbBufferToJson(dbBuffer, database);
    return cloudRecords;
  }
  static async uploadDatabase(type: string) {
    if (ConfigService.getReaderConfig("isEnableKoodoSync") === "yes") {
      let data = await DatabaseService.getAllRecords(type);
      if (type === "books") {
        data = data.map((record) => {
          record.cover = "";
          return record;
        });
      }
      this.updateData[type] = JSON.stringify(data);
      return;
    }
    let dbBuffer = await DatabaseService.getDbBuffer(type);
    let dbBlob = new Blob([dbBuffer], { type: CommonTool.getMimeType("db") });
    let syncUtil = await SyncService.getSyncUtil();
    await syncUtil.uploadFile(type + ".db", "config", dbBlob);
  }
  static async getNotesByBookKeyAndTypeWithSort(
    bookKey: string,
    type: string,
    sort: string = "key",
    order: string = "DESC"
  ) {
    let notes: Note[] = await DatabaseService.getAllRecords("notes");
    let filteredNotes = notes.filter((note) => {
      let typeMatch =
        (type === "note" && note.notes !== "") ||
        (type === "highlight" && note.notes === "") ||
        !type;
      let bookKeyMatch = bookKey ? note.bookKey === bookKey : true;
      return typeMatch && bookKeyMatch;
    });
    if (sort === "key") {
      filteredNotes.sort((a, b) => {
        if (order === "ASC") {
          return Number(a.key) - Number(b.key);
        } else {
          return Number(b.key) - Number(a.key);
        }
      });
    } else if (sort === "percentage") {
      filteredNotes.sort((a, b) => {
        if (order === "ASC") {
          return Number(a.percentage) - Number(b.percentage);
        } else {
          return Number(b.percentage) - Number(a.percentage);
        }
      });
    }
    return filteredNotes;
  }
  static async searchNotesByKeyword(
    keyword: string,
    bookKey: string,
    type: string
  ) {
    let notes = await DatabaseService.getAllRecords("notes");
    let filteredNotes = notes.filter(
      (note) =>
        ((type === "note" && note.notes !== "") ||
          (type === "highlight" && note.notes === "") ||
          !type) &&
        (note.bookKey === bookKey || !bookKey) &&
        (note.notes.toLowerCase().includes(keyword.toLowerCase()) ||
          note.text.toLowerCase().includes(keyword.toLowerCase()))
    );
    filteredNotes.sort((a, b) => b.key - a.key);
    return filteredNotes;
  }
  static async getNoteWithTags(tags: string[]) {
    let notes = await DatabaseService.getAllRecords("notes");
    let filteredNotes = notes.filter((note) => {
      for (let i = 0; i < tags.length; i++) {
        if (!note.tag.includes(tags[i])) {
          return false;
        }
      }
      return true;
    });
    filteredNotes.sort((a, b) => b.key - a.key);
    return filteredNotes;
  }
  static async deleteTagFromNotes(tagName: string) {
    let notes: any[] = await DatabaseService.getAllRecords("notes");
    let filteredNotes = notes.filter((note) => note.tag.includes(tagName));
    let updatedNotes = filteredNotes.map((item) => {
      return {
        ...item,
        tag: item.tag.filter((subitem) => subitem !== tagName),
      };
    });
    for (let i = 0; i < updatedNotes.length; i++) {
      await DatabaseService.updateRecord(updatedNotes[i], "notes");
    }
  }
  static async getNoteList() {
    let notes = await DatabaseService.getAllRecords("notes");
    notes.sort((a, b) => b.key - a.key);
    return notes;
  }
  static async dumpConfig(type: string) {
    let config = {};
    if (type === "sync") {
      config = ConfigService.getAllSyncRecord();
    } else {
      let configList = CommonTool.configList;
      configList = [
        ...configList,
        "dictList",
        "backgroundList",
        "readerConfig",
        "customBackgrounds",
        "customDicts",
      ];
      for (let i = 0; i < configList.length; i++) {
        let item = configList[i];
        if (ConfigService.getItem(item)) {
          config[item] = ConfigService.getItem(item);
        }
      }
    }
    return config;
  }
  static clearConfig(type: string) {
    if (type === "sync") {
      ConfigService.removeItem("syncRecord");
    } else {
      let configList = CommonTool.configList;
      for (let i = 0; i < configList.length; i++) {
        let item = configList[i];
        ConfigService.removeItem(item);
      }
    }
  }
  static async loadConfig(type: string, configStr: string) {
    let tempConfig = JSON.parse(configStr);
    if (type === "sync") {
      ConfigService.setAllSyncRecord(tempConfig);
    } else {
      for (let key in tempConfig) {
        ConfigService.setItem(key, tempConfig[key]);
      }
    }
  }
  static async isCloudEmpty() {
    let syncDataStr = await this.downloadConfig("sync");
    let syncData = JSON.parse(syncDataStr || "{}");
    if (!syncData || Object.keys(syncData).length === 0) {
      return true;
    }
    return false;
  }
}
export default ConfigUtil;
