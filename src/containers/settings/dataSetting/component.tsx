import React from "react";
import { SettingInfoProps, SettingInfoState } from "./interface";
import { Trans } from "react-i18next";
import {
  clearAllData,
  getStorageLocation,
  getWebsiteUrl,
  reloadManager,
  vexOpenAsync,
  vexPromptAsync,
} from "../../../utils/common";

import toast from "react-hot-toast";
import { LocalFileManager } from "../../../utils/file/localFile";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { verifyAndBuildKOReaderSyncConfig } from "../../../utils/file/koReaderSync";
import {
  exportBooks,
  exportDictionaryHistory,
  exportHighlights,
  exportNotes,
} from "../../../utils/file/export";
import DatabaseService from "../../../utils/storage/databaseService";
import {
  dataSettingList,
  noteSyncSettingList,
  wordSyncSettingList,
} from "../../../constants/settingList";
declare var window: any;
class DataSetting extends React.Component<SettingInfoProps, SettingInfoState> {
  constructor(props: SettingInfoProps) {
    super(props);
    this.state = {
      storageLocation: getStorageLocation() || "",
      snapshotList: [],
      exportNotesFormat: "",
      exportHighlightsFormat: "",
      isEnableKoReaderSync:
        ConfigService.getReaderConfig("isEnableKoReaderSync") === "yes",
      isEnableNotionSync:
        ConfigService.getReaderConfig("isEnableNotionSync") === "yes",
      isEnableYuqueSync:
        ConfigService.getReaderConfig("isEnableYuqueSync") === "yes",
      isEnableReadwiseSync:
        ConfigService.getReaderConfig("isEnableReadwiseSync") === "yes",
      isEnableEudicSync:
        ConfigService.getReaderConfig("isEnableEudicSync") === "yes",
      isEnableAnkiSync:
        ConfigService.getReaderConfig("isEnableAnkiSync") === "yes",
    };
  }
  async componentDidMount() {
    const status = await LocalFileManager.getPermissionStatus();
    this.setState({
      storageLocation: status.directoryName || "",
      snapshotList: [],
    });
  }
  handleSetting = (stateName: string) => {
    this.setState({ [stateName]: !this.state[stateName] } as any);
    ConfigService.setReaderConfig(
      stateName,
      this.state[stateName] ? "no" : "yes"
    );
    toast.success(this.props.t("Change successful"));
  };

  handleKOReaderSyncSetting = async () => {
    const currentlyEnabled = this.state.isEnableKoReaderSync;
    if (currentlyEnabled) {
      this.setState({ isEnableKoReaderSync: false });
      ConfigService.setReaderConfig("isEnableKoReaderSync", "no");
      toast.success(this.props.t("Change successful"));
      return;
    }

    const savedConfig =
      ConfigService.getObjectConfig(
        "koReaderSyncConfig",
        "thirdpartyToken",
        {}
      ) || {};
    const labels = {
      serverUrl: this.props.t("Server address"),
      username: this.props.t("Username"),
      password: this.props.t("Password"),
    };
    const result = await vexOpenAsync(
      {
        serverUrl: {
          value: savedConfig.serverUrl || "",
          placeholder: "https://sync.koreader.rocks",
          type: "text",
        },
        username: {
          value: savedConfig.username || "",
          placeholder: this.props.t("Enter username"),
          type: "text",
        },
        password: {
          value: "",
          placeholder:
            savedConfig.passwordHash && savedConfig.username
              ? this.props.t("Leave blank to keep the current password")
              : this.props.t("Enter password"),
          type: "password",
        },
      },
      "",
      labels,
      getWebsiteUrl() +
        `/${
          ConfigService.getReaderConfig("lang") &&
          ConfigService.getReaderConfig("lang").startsWith("zh")
            ? "zh"
            : "en"
        }/add-thirdparty`
    );

    if (!result) {
      return;
    }

    if (!result.serverUrl || !result.username) {
      toast.error(this.props.t("Please fill in all fields"));
      return;
    }
    if (!result.password && !savedConfig.passwordHash) {
      toast.error(this.props.t("Please fill in all fields"));
      return;
    }

    try {
      toast.loading(this.props.t("Validating server info..."), {
        id: "ko-reader-sync",
      });
      const verifiedConfig = await verifyAndBuildKOReaderSyncConfig({
        serverUrl: result.serverUrl,
        username: result.username,
        password: result.password,
        passwordHash:
          !result.password && savedConfig.username === result.username
            ? savedConfig.passwordHash
            : "",
      });
      ConfigService.setObjectConfig(
        "koReaderSyncConfig",
        verifiedConfig,
        "thirdpartyToken"
      );
      this.setState({ isEnableKoReaderSync: true });
      ConfigService.setReaderConfig("isEnableKoReaderSync", "yes");
      toast.success(this.props.t("Validation successful"), {
        id: "ko-reader-sync",
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : this.props.t("Validation failed"),
        {
          id: "ko-reader-sync",
        }
      );
    }
  };

  handleDataSetting = async (item: any) => {
    if (item.propName === "isEnableKoReaderSync") {
      await this.handleKOReaderSyncSetting();
      return;
    }
    this.handleSetting(item.propName);
  };

  handleNoteSyncSetting = async (item: any) => {
    const currentlyEnabled = this.state[item.propName];

    if (!currentlyEnabled && item.requiresAuth) {
      // Enabling: prompt for auth credentials
      const existingConfig = ConfigService.getObjectConfig(
        item.authConfigKey,
        "thirdpartyToken",
        {}
      );
      let savedValues: Record<string, any> = {};
      if (existingConfig && Object.keys(existingConfig).length > 0) {
        savedValues = existingConfig;
      }
      // Build defaultValues record: key -> saved value or placeholder
      const defaultValues: Record<string, any> = {};
      const labelsMap: Record<string, string> = {};
      for (const field of item.authFields as Array<{
        key: string;
        label: string;
        placeholder: string;
      }>) {
        defaultValues[field.key] =
          savedValues[field.key] ?? "[" + this.props.t(field.placeholder) + "]";
        labelsMap[field.key] = this.props.t(field.label);
      }

      const result = await vexOpenAsync(
        defaultValues,
        "",
        labelsMap,
        "https://koodoreader.com/zh/add-thirdparty"
      );

      if (!result) {
        // User cancelled
        return;
      }

      // Validate that all fields are filled
      const allFilled = Object.values(result).every(
        (v) => v && String(v).trim().length > 0
      );
      if (!allFilled) {
        toast.error(this.props.t("Please fill in all fields"));
        return;
      }

      // Save auth config
      ConfigService.setObjectConfig(
        item.authConfigKey,
        result,
        "thirdpartyToken"
      );

      // Enable the setting
      this.setState({ [item.propName]: true } as any);
      ConfigService.setReaderConfig(item.propName, "yes");
      toast.success(this.props.t("Change successful"));
    } else {
      // Disabling: just toggle off
      this.setState({ [item.propName]: false } as any);
      ConfigService.setReaderConfig(item.propName, "no");
      toast.success(this.props.t("Change successful"));
    }
  };

  renderNoteSyncOptions = () => {
    return noteSyncSettingList.map((item) => {
      return (
        <div key={item.propName}>
          <div className="setting-dialog-new-title" key={item.title}>
            <span style={{ width: "calc(100% - 100px)" }}>
              <Trans>{item.title}</Trans>
            </span>
            <span
              className="single-control-switch"
              onClick={() => {
                this.handleNoteSyncSetting(item);
              }}
              style={this.state[item.propName] ? {} : { opacity: 0.6 }}
            >
              <span
                className="single-control-button"
                style={
                  this.state[item.propName]
                    ? {
                        transform: "translateX(20px)",
                        transition: "transform 0.5s ease",
                      }
                    : {
                        transform: "translateX(0px)",
                        transition: "transform 0.5s ease",
                      }
                }
              ></span>
            </span>
          </div>
          <p className="setting-option-subtitle">
            <Trans>{item.desc}</Trans>
          </p>
        </div>
      );
    });
  };

  renderWordSyncOptions = () => {
    return wordSyncSettingList.map((item) => {
      return (
        <div key={item.propName}>
          <div className="setting-dialog-new-title" key={item.title}>
            <span style={{ width: "calc(100% - 100px)" }}>
              <Trans>{item.title}</Trans>
            </span>
            <span
              className="single-control-switch"
              onClick={() => {
                this.handleNoteSyncSetting(item);
              }}
              style={this.state[item.propName] ? {} : { opacity: 0.6 }}
            >
              <span
                className="single-control-button"
                style={
                  this.state[item.propName]
                    ? {
                        transform: "translateX(20px)",
                        transition: "transform 0.5s ease",
                      }
                    : {
                        transform: "translateX(0px)",
                        transition: "transform 0.5s ease",
                      }
                }
              ></span>
            </span>
          </div>
          <p className="setting-option-subtitle">
            <Trans>{item.desc}</Trans>
          </p>
        </div>
      );
    });
  };

  renderSwitchOption = (optionList: any[]) => {
    return optionList.map((item) => {
      return (
        <div key={item.propName}>
          <div className="setting-dialog-new-title" key={item.title}>
            <span style={{ width: "calc(100% - 100px)" }}>
              <Trans>{item.title}</Trans>
            </span>
            <span
              className="single-control-switch"
              onClick={() => {
                this.handleDataSetting(item);
              }}
              style={this.state[item.propName] ? {} : { opacity: 0.6 }}
            >
              <span
                className="single-control-button"
                style={
                  this.state[item.propName]
                    ? {
                        transform: "translateX(20px)",
                        transition: "transform 0.5s ease",
                      }
                    : {
                        transform: "translateX(0px)",
                        transition: "transform 0.5s ease",
                      }
                }
              ></span>
            </span>
          </div>
          <p className="setting-option-subtitle">
            <Trans>{item.desc}</Trans>
          </p>
        </div>
      );
    });
  };

  handleSwitchLibrary = async () => {
    try {
      const directoryHandle = await LocalFileManager.requestDirectoryAccess();

      if (directoryHandle) {
        ConfigService.setReaderConfig("isUseLocal", "yes");
        ConfigService.setReaderConfig(
          "localDirectoryName",
          directoryHandle.name
        );
        this.setState({
          storageLocation: directoryHandle.name,
        });
        toast.success(this.props.t("Local folder access granted successfully"));
        this.props.handleFetchBooks();
      setTimeout(() => {
        this.props.history.push("/manager/home");
      }, 2000);
      } else {
        toast.success(this.props.t("Failed to get folder access permission"));
      }
    } catch (error) {
      toast.error(
        "Error selecting folder:" +
          (error instanceof Error ? error.message : String(error))
      );
      console.error("Error selecting folder:", error);
      toast.success(this.props.t("Error occurred while selecting folder"));
    }
  };
  render() {
    return (
      <>
        {this.renderSwitchOption(dataSettingList)}
        {this.renderNoteSyncOptions()}
        {this.renderWordSyncOptions()}
        {this.state.storageLocation && (
          <>
            <div className="setting-dialog-new-title">
              <Trans>Switch Library</Trans>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <span
                  className="change-location-button"
                  onClick={() => {
                    this.handleSwitchLibrary();
                  }}
                >
                  <Trans>Select</Trans>
                </span>
              </div>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                {
                  "Switch between multiple libraries without affecting the original library. For multi-device synchronization in the free version, please refer to the documentation"
                }
              </Trans>
            </p>
            <div className="setting-dialog-location-title">
              {this.state.storageLocation}
            </div>
          </>
        )}
        <div className="setting-dialog-new-title">
          <Trans>Export all books</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              let books = await DatabaseService.getAllRecords("books");
              if (books.length > 0) {
                await exportBooks(books);
                toast.success(this.props.t("Export successful"));
              } else {
                toast(this.props.t("Nothing to export"));
              }
            }}
          >
            <Trans>Export</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Export all notes</Trans>
          <select
            className="lang-setting-dropdown"
            value={this.state.exportNotesFormat}
            onChange={async (event) => {
              const fmt = event.target.value as
                | "csv"
                | "md"
                | "txt"
                | "html"
                | "pdf"
                | "";
              if (!fmt) return;
              this.setState({ exportNotesFormat: "" });
              let books = await DatabaseService.getAllRecords("books");
              let notes = await DatabaseService.getAllRecords("notes");
              notes = notes.filter(
                (note: any) => note.notes && note.notes.length > 0
              );
              if (notes.length > 0) {
                exportNotes(notes, books, fmt);
                toast.success(this.props.t("Export successful"));
              } else {
                toast(this.props.t("Nothing to export"));
              }
            }}
          >
            <option value="" className="lang-setting-option">
              {this.props.t("Select format")}
            </option>
            <option value="csv" className="lang-setting-option">
              CSV
            </option>
            <option value="md" className="lang-setting-option">
              Markdown
            </option>
            <option value="txt" className="lang-setting-option">
              TXT
            </option>
            <option value="html" className="lang-setting-option">
              HTML
            </option>
            <option value="pdf" className="lang-setting-option">
              PDF
            </option>
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Export all highlights</Trans>
          <select
            className="lang-setting-dropdown"
            value={this.state.exportHighlightsFormat}
            onChange={async (event) => {
              const fmt = event.target.value as
                | "csv"
                | "md"
                | "txt"
                | "html"
                | "pdf"
                | "";
              if (!fmt) return;
              this.setState({ exportHighlightsFormat: "" });
              let books = await DatabaseService.getAllRecords("books");
              let notes = await DatabaseService.getAllRecords("notes");
              notes = notes.filter((note: any) => note.notes === "");
              if (notes.length > 0) {
                exportHighlights(notes, books, fmt);
                toast.success(this.props.t("Export successful"));
              } else {
                toast(this.props.t("Nothing to export"));
              }
            }}
          >
            <option value="" className="lang-setting-option">
              {this.props.t("Select format")}
            </option>
            <option value="csv" className="lang-setting-option">
              CSV
            </option>
            <option value="md" className="lang-setting-option">
              Markdown
            </option>
            <option value="txt" className="lang-setting-option">
              TXT
            </option>
            <option value="html" className="lang-setting-option">
              HTML
            </option>
            <option value="pdf" className="lang-setting-option">
              PDF
            </option>
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Export all dictionary history</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              let dictHistory = await DatabaseService.getAllRecords("words");
              let books = await DatabaseService.getAllRecords("books");
              if (dictHistory.length > 0) {
                exportDictionaryHistory(dictHistory, books);
                toast.success(this.props.t("Export successful"));
              } else {
                toast(this.props.t("Nothing to export"));
              }
            }}
          >
            <Trans>Export</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Clear all data</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              let answer = await vexPromptAsync(
                this.props.t("Please type 'CLEAR' to confirm"),
                "",
                ""
              );
              window.vex.closeAll(); // 关闭对话框
              if (answer === "CLEAR") {
                await clearAllData();
                toast.success(this.props.t("Clear successful"));
                setTimeout(() => {
                  reloadManager();
                }, 300);
              } else if (answer) {
                toast.error(this.props.t("Please type 'CLEAR' to confirm"));
              }
            }}
          >
            <Trans>Clear</Trans>
          </span>
        </div>
      </>
    );
  }
}

export default DataSetting;
