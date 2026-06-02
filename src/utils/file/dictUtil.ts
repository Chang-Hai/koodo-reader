import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { LocalFileManager } from "./localFile";
import localforage from "localforage";

const DICT_FOLDER = "dict";

export interface DictMeta {
  id: string;
  name: string;
  extension: string;
}

class DictUtil {
  static saveDictFromPath(id: string, sourcePath: string): void {
    return;
  }

  /** Save dict file (ArrayBuffer) by id */
  static async saveDict(
    id: string,
    name: string,
    arrayBuffer: ArrayBuffer
  ): Promise<void> {
    const ext = name.split(".").pop()?.toLowerCase() || "mdx";
    const filename = `${id}.${ext}`;

    if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
      await LocalFileManager.saveFile(filename, arrayBuffer, DICT_FOLDER);
    } else {
      await localforage.setItem(`dict_${id}`, arrayBuffer);
    }
  }

  /** Delete dict file by id */
  static async deleteDict(id: string): Promise<void> {
    if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
      for (const ext of ["mdx"]) {
        await LocalFileManager.deleteFile(`${id}.${ext}`, DICT_FOLDER).catch(
          () => {}
        );
      }
    } else {
      await localforage.removeItem(`dict_${id}`);
    }
  }

  static getDictFilePath(id: string): string | null {
    return null;
  }

  /** Look up a word in the local MDX dictionary */
  static async lookupWord(id: string, word: string): Promise<string> {
    return "";
  }

  /** Save dict metadata */
  static saveDictMeta(id: string, meta: Omit<DictMeta, "id">): void {
    ConfigService.setObjectConfig(id, { id, ...meta }, "customDicts");
  }

  /** Get dict metadata */
  static getDictMeta(id: string): DictMeta | null {
    return ConfigService.getObjectConfig(id, "customDicts", null);
  }

  /** Delete dict metadata */
  static deleteDictMeta(id: string): void {
    ConfigService.setObjectConfig(id, null, "customDicts");
  }

  /** Return all stored dict ids */
  static getDictIds(): string[] {
    return ConfigService.getAllListConfig("dictList") || [];
  }

  static addDictId(id: string): void {
    ConfigService.setListConfig(id, "dictList");
  }

  static removeDictId(id: string): void {
    ConfigService.deleteListConfig(id, "dictList");
  }
}

export default DictUtil;
