import React from "react";
import "./importLocal.css";
import BookModel from "../../models/Book";

import { Trans } from "react-i18next";
import Dropzone from "react-dropzone";
import * as Kookit from "../../assets/lib/kookit.min";
import { ImportLocalProps, ImportLocalState } from "./interface";
import { withRouter } from "react-router-dom";
import BookUtil from "../../utils/file/bookUtil";
import toast from "react-hot-toast";
import {
  CommonTool,
  ConfigService,
} from "../../assets/lib/kookit-extra-browser.min";
import CoverUtil from "../../utils/file/coverUtil";
import { calculateFileMD5, supportedFormats } from "../../utils/common";
import DatabaseService from "../../utils/storage/databaseService";
import { BookHelper } from "../../assets/lib/kookit.min";

// Convert supportedFormats to react-dropzone v14+ accept format
// Key is MIME type, value is array of file extensions
const supportedFormatsAccept = supportedFormats.reduce<
  Record<string, string[]>
>((obj, ext) => {
  const mimeType = CommonTool.getMimeType(ext.replace(".", ""));
  if (mimeType) {
    if (!obj[mimeType]) obj[mimeType] = [];
    obj[mimeType].push(ext);
  }
  return obj;
}, {});
declare var window: any;
let clickFilePath = "";

class ImportLocal extends React.Component<ImportLocalProps, ImportLocalState> {
  constructor(props: ImportLocalProps) {
    super(props);
    this.state = {
      isOpenFile: false,
      width: document.body.clientWidth,
      isMoreOptionsVisible: false,
      importingShelfTitle: "",
    };
  }
  componentDidMount() {
    window.addEventListener("resize", () => {
      this.setState({ width: document.body.clientWidth });
    });
    this.props.handleImportBookFunc(this.getMd5WithBrowser);
  }
  handleJump = (book: BookModel) => {
    ConfigService.setItem("tempBook", JSON.stringify(book));
    BookUtil.redirectBook(book);
    this.props.history.push("/manager/home");
  };
  handleAddBook = (book: BookModel, buffer: ArrayBuffer) => {
    return new Promise<void>(async (resolve) => {
      toast.loading(
        this.props.t("Importing") + ": " + book.name.substring(0, 50),
        {
          id: "add-book",
        }
      );
      if (this.state.isOpenFile) {
        if (ConfigService.getReaderConfig("isPreventAdd") === "yes") {
          //ignore
        } else if (
          this.props.isAuthed &&
          ConfigService.getItem("defaultSyncOption")
        ) {
          await BookUtil.addBook(book.key, book.format.toLowerCase(), buffer);
          await CoverUtil.addCover(book);
        } else if (ConfigService.getReaderConfig("isImportPath") === "yes") {
          await CoverUtil.addCover(book);
          //ignore
        } else {
          await BookUtil.addBook(book.key, book.format.toLowerCase(), buffer);
          await CoverUtil.addCover(book);
        }
        if (ConfigService.getReaderConfig("isPreventAdd") === "yes") {
          this.handleJump(book);
          this.setState({ isOpenFile: false });
          toast.dismiss("add-book");
          return resolve();
        }
      } else {
        if (
          ConfigService.getReaderConfig("isImportPath") !== "yes" ||
          (this.props.isAuthed && ConfigService.getItem("defaultSyncOption"))
        ) {
          await BookUtil.addBook(book.key, book.format.toLowerCase(), buffer);
        }

        await CoverUtil.addCover(book);
      }

      this.props.handleReadingBook(book);
      ConfigService.setListConfig(book.key, "recentBooks");
      DatabaseService.saveRecord(book, "books")
        .then(() => {
          this.props.handleFetchBooks();
          if (this.props.mode === "shelf") {
            if (!this.state.importingShelfTitle) {
              this.setState({ importingShelfTitle: this.props.shelfTitle });
            }
            ConfigService.setMapConfig(
              this.state.importingShelfTitle || this.props.shelfTitle,
              book.key,
              "shelfList"
            );
          }
          toast.success(
            this.props.t("Addition successful") +
              ": " +
              book.name.substring(0, 50),
            {
              id: "add-book",
            }
          );
          setTimeout(() => {
            this.state.isOpenFile && this.handleJump(book);
            if (
              ConfigService.getReaderConfig("isOpenInMain") === "yes" &&
              this.state.isOpenFile
            ) {
              this.setState({ isOpenFile: false });
              return;
            }
            this.setState({ isOpenFile: false });
            this.props.history.push("/manager/home");
          }, 100);
          return resolve();
        })
        .catch((error) => {
          console.error(error, book.name);
          toast.error(
            this.props.t("Import failed") + ": " + book.name.substring(0, 50),
            {
              duration: 4000,
              id: "add-book",
            }
          );
          return resolve();
        });
    });
  };

  getMd5WithBrowser = async (file: any) => {
    return new Promise<void>(async (resolve) => {
      const md5 = await calculateFileMD5(file);
      if (!md5) {
        console.error("md5 error", file.name);
        toast.error(this.props.t("Import failed") + ": " + file.name, {
          duration: 4000,
        });
        return resolve();
      } else {
        try {
          await this.handleBook(file, md5);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          toast.error(errorMessage);
          console.error(error);
        }

        return resolve();
      }
    });
  };

  handleBook = (file: any, md5: string) => {
    let extension = (file.name as string)
      .split(".")
      .reverse()[0]
      .toLocaleLowerCase();
    let bookName = file.name.substr(0, file.name.length - extension.length - 1);
    let result: BookModel;
    return new Promise<void>(async (resolve) => {
      let isRepeat = false;
      let repeatBook: BookModel | null = await BookUtil.getBookByMd5(md5);
      if (repeatBook) {
        isRepeat = true;
        if (this.props.books && this.props.books.length > 0) {
          this.props.books.forEach((item) => {
            if (item.key === repeatBook!.key) {
              toast.error(this.props.t("Duplicate book"));
              return resolve();
            }
          });
        }
        if (this.props.deletedBooks && this.props.deletedBooks.length > 0) {
          this.props.deletedBooks.forEach((item) => {
            if (item.key === repeatBook!.key) {
              toast.error(this.props.t("Duplicate book in trash bin"));
              return resolve();
            }
          });
        }
        return resolve();
      }
      if (!isRepeat) {
        let reader = new FileReader();
        reader.readAsArrayBuffer(file);

        reader.onload = async (e) => {
          if (!e.target) {
            console.error("e.target error", bookName);
            toast.error(this.props.t("Import failed") + ": " + bookName, {
              duration: 4000,
            });
            return resolve();
          }
          let reader = new FileReader();
          reader.onload = async (event) => {
            const file_content = (event.target as any).result;
            try {
              let rendition = BookHelper.getRendition(
                file_content,
                {
                  format: extension.toUpperCase(),
                  readerMode: "",
                  charset: "",
                  animation:
                    ConfigService.getReaderConfig("isSliding") === "yes"
                      ? "sliding"
                      : "",
                  convertChinese:
                    ConfigService.getReaderConfig("convertChinese"),
                  fullTranslationMode: "no",
                  textOrientation:
                    ConfigService.getReaderConfig("textOrientation"),
                  parserRegex: "",
                  isDarkMode: "no",
                  isMobile: "no",
                  password: "",
                  isScannedPDF: "no",
                },
                Kookit
              );
              result = await BookHelper.generateBook(
                bookName,
                extension,
                md5,
                file.size,
                file.path || clickFilePath,
                file_content,
                rendition
              );
              if (
                ConfigService.getReaderConfig("isUseOriginalName") === "yes"
              ) {
                result.name = bookName;
              }
              if (
                ConfigService.getReaderConfig("isPrecacheBook") === "yes" &&
                extension !== "pdf"
              ) {
                let cache = await rendition.preCache(file_content);
                if (cache !== "err" || cache) {
                  await BookUtil.addBook("cache-" + result.key, "zip", cache);
                }
              }
            } catch (error) {
              console.error(error, bookName);
              toast.error(this.props.t("Import failed") + ": " + bookName, {
                duration: 4000,
              });
              return resolve();
            }

            clickFilePath = "";

            // get metadata failed
            if (!result || !result.key) {
              console.error("get metadata failed", bookName);
              toast.error(this.props.t("Import failed") + ": " + bookName, {
                duration: 4000,
              });
              return resolve();
            }
            await this.handleAddBook(
              result as BookModel,
              file_content as ArrayBuffer
            );

            return resolve();
          };
          reader.readAsArrayBuffer(file);
        };
      }
    });
  };
  toggleMoreOptions = () => {
    this.setState((prevState) => ({
      isMoreOptionsVisible: !prevState.isMoreOptionsVisible,
    }));
  };

  // Add method to handle cloud import
  handleCloudImport = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the Dropzone
    this.setState({ isMoreOptionsVisible: false });

    this.props.handleImportDialog(true);
  };

  // Handle OPDS import
  handleOPDSImport = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the Dropzone
    this.setState({ isMoreOptionsVisible: false });
    this.props.handleOPDSDialog(true);
  };
  render() {
    return (
      <Dropzone
        onDrop={async (acceptedFiles) => {
          this.props.handleDrag(false);
          if (ConfigService.getReaderConfig("isImportPath") === "yes") {
            toast.error(
              this.props.t("Please turn off import books as link first")
            );
            return;
          }
          if (this.props.mode === "shelf") {
            this.setState({ importingShelfTitle: this.props.shelfTitle });
          }
          for (let item of acceptedFiles) {
            await this.getMd5WithBrowser(item);
          }
          this.setState({ importingShelfTitle: "" });
        }}
        accept={supportedFormatsAccept}
        multiple={true}
      >
        {({ getRootProps, getInputProps }) => (
          <div
            className="import-from-local"
            {...getRootProps()}
            style={
              this.props.isCollapsed && document.body.clientWidth < 950
                ? { width: "42px" }
                : {}
            }
          >
            {this.props.isCollapsed && this.state.width < 950 ? null : (
              <div
                className="more-import-option"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent triggering the Dropzone
                  this.toggleMoreOptions();
                }}
              >
                <span className="dropdown-triangle"></span>
                {this.state.isMoreOptionsVisible && (
                  <div
                    className="more-options-dropdown"
                    onMouseLeave={this.toggleMoreOptions}
                    style={
                      this.state.width < 950
                        ? {
                            bottom: "calc(100% + 5px)",
                            top: "unset",
                            right: "unset",
                            left: "-110px",
                          }
                        : {}
                    }
                  >
                    <div
                      className="more-option-item"
                      onClick={async (event) => {
                        event.stopPropagation(); // Prevent triggering the Dropzone
                      }}
                    >
                      <span className="more-option-text">
                        <Trans>Import folder</Trans>
                      </span>
                      <input
                        type="file"
                        {...({
                          webkitdirectory: "",
                          mozdirectory: "",
                          directory: "",
                        } as React.InputHTMLAttributes<HTMLInputElement>)}
                        multiple
                        style={{
                          position: "absolute",
                          width: "100%",
                          height: "45px",
                          opacity: 0,
                          marginLeft: "-20px",
                          cursor: "pointer",
                        }}
                        onChange={async (e) => {
                          const files = e.target.files;
                          if (!files || files.length === 0) {
                            return;
                          }
                          if (this.props.mode === "shelf") {
                            this.setState({
                              importingShelfTitle: this.props.shelfTitle,
                            });
                          }
                          for (let item of files) {
                            if (
                              !supportedFormats.find((format) =>
                                item.name.toLowerCase().endsWith(format)
                              )
                            ) {
                              continue;
                            }
                            await this.getMd5WithBrowser(item);
                          }
                          this.setState({ importingShelfTitle: "" });
                          this.toggleMoreOptions();
                        }}
                      ></input>
                    </div>
                    <div
                      className="more-option-item"
                      onClick={this.handleCloudImport}
                    >
                      <span className="more-option-text">
                        <Trans>From cloud storage</Trans>
                      </span>
                    </div>
                    <div
                      className="more-option-item"
                      onClick={this.handleOPDSImport}
                    >
                      <span className="more-option-text">
                        <Trans>From OPDS</Trans>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="animation-mask-local"></div>
            {this.state.width < 950 ? (
              <span
                className="icon-folder"
                style={{ fontSize: "15px", fontWeight: 500 }}
              ></span>
            ) : (
              <span>
                <Trans>Import</Trans>
              </span>
            )}

            <input
              type="file"
              id="import-book-box"
              className="import-book-box"
              name="file"
              {...getInputProps()}
            />
          </div>
        )}
      </Dropzone>
    );
  }
}

export default withRouter(ImportLocal as any);
