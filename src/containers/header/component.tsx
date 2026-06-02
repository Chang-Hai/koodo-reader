import React from "react";
import "./header.css";
import SearchBox from "../../components/searchBox";
import ImportLocal from "../../components/importLocal";
import { HeaderProps, HeaderState } from "./interface";
import {
  ConfigService,
  TokenService,
} from "../../assets/lib/kookit-extra-browser.min";
import UpdateInfo from "../../components/dialogs/updateDialog";
import { restoreFromConfigJson } from "../../utils/file/restore";
import { backupToConfigJson } from "../../utils/file/backup";
import {
  getCloudConfig,
  getLastSyncTimeFromConfigJson,
  removeCloudConfig,
  upgradeConfig,
} from "../../utils/file/common";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import { SyncHelper } from "../../assets/lib/kookit-extra-browser.min";
import ConfigUtil from "../../utils/file/configUtil";
import DatabaseService from "../../utils/storage/databaseService";
import CoverUtil from "../../utils/file/coverUtil";
import BookUtil from "../../utils/file/bookUtil";
import {
  isKOReaderSyncEnabled,
  syncKOReaderProgress,
} from "../../utils/file/koReaderSync";
import {
  addChatBox,
  checkBrokenDatabase,
  checkMissingBook,
  generateSyncRecord,
  getTaskStats,
  getWebsiteUrl,
  openInBrowser,
  removeChatBox,
  resetKoodoSync,
  showTaskProgress,
  vexComfirmAsync,
} from "../../utils/common";
import { driveList } from "../../constants/driveList";
import SupportDialog from "../../components/dialogs/supportDialog";
import SyncService from "../../utils/storage/syncService";
import { LocalFileManager } from "../../utils/file/localFile";
import { getTempToken, updateUserConfig } from "../../utils/request/user";
import i18n from "../../i18n";
import {
  bootstrapSelfHostedServerStorage,
  shouldSuppressSelfHostedLocalFolderPrompt,
} from "../../utils/selfHostedServerStorage";
import { isSelfHostedOfflineFirst } from "../../utils/selfHostedWebUnlock";

class Header extends React.Component<HeaderProps, HeaderState> {
  timer: any;
  scheduledSyncTimer: any;
  private isSyncing: boolean = false;
  constructor(props: HeaderProps) {
    super(props);

    this.state = {
      isOnlyLocal: false,
      language: ConfigService.getReaderConfig("lang"),
      isNewVersion: false,
      width: document.body.clientWidth,
      isDataChange: false,
      isHidePro: false,
      isSync: false,
    };
  }
  async componentDidMount() {
    this.props.handleFetchAuthed();
    if (isSelfHostedOfflineFirst()) {
      ConfigService.setReaderConfig("isDisableAutoSync", "yes");
      ConfigService.setReaderConfig("isUseLocal", "no");
    }
    const didBootstrapSelfHostedStorage =
      await bootstrapSelfHostedServerStorage();
    this.props.handleFetchDefaultSyncOption();
    this.props.handleFetchDataSourceList();
    if (didBootstrapSelfHostedStorage) {
      this.props.handleFetchBooks();
    }
    upgradeConfig();
    if (ConfigService.getReaderConfig("isHidePro") === "yes") {
      this.setState({ isHidePro: true });
    }
    const status = await LocalFileManager.getPermissionStatus();
    if (shouldSuppressSelfHostedLocalFolderPrompt()) {
      ConfigService.setReaderConfig("isUseLocal", "no");
      this.props.handleLocalFileDialog(false);
    } else if (
      !ConfigService.getReaderConfig("isUseLocal") &&
      LocalFileManager.isSupported()
    ) {
      this.props.handleLocalFileDialog(true);
    } else if (
      ConfigService.getReaderConfig("isUseLocal") === "yes" &&
      !status.directoryName
    ) {
      this.props.handleLocalFileDialog(true);
    } else if (
      ConfigService.getReaderConfig("isUseLocal") === "yes" &&
      (status.needsReauthorization || !status.hasAccess)
    ) {
      this.props.handleLocalFileDialog(true);
    }
    window.addEventListener("resize", () => {
      this.setState({ width: document.body.clientWidth });
    });
    this.props.handleCloudSyncFunc(this.handleCloudSync);
    document.addEventListener("visibilitychange", async (event) => {
      if (
        document.visibilityState === "visible" &&
        ConfigService.getReaderConfig("isFinishWebReading") === "yes"
      ) {
        await this.handleFinishReading();
        // ConfigService.setReaderConfig("isFinishWebReading", "no");
      }
    });
    let willAutoSync =
      !isSelfHostedOfflineFirst() &&
      ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
      ConfigService.getItem("defaultSyncOption");
    if (!willAutoSync) {
      this.handleOpenLastReadBook();
    }
    this.startScheduledSync();
  }
  componentWillUnmount() {
    if (this.scheduledSyncTimer) {
      clearInterval(this.scheduledSyncTimer);
      this.scheduledSyncTimer = null;
    }
  }
  startScheduledSync = () => {
    if (this.scheduledSyncTimer) {
      clearInterval(this.scheduledSyncTimer);
      this.scheduledSyncTimer = null;
    }
    const intervalMinutes = parseInt(
      ConfigService.getReaderConfig("scheduledSyncInterval") || "0"
    );
    if (isSelfHostedOfflineFirst() || !intervalMinutes || intervalMinutes <= 0) {
      return;
    }
    const intervalMs = intervalMinutes * 60 * 1000;
    this.scheduledSyncTimer = setInterval(async () => {
      const currentInterval = parseInt(
        ConfigService.getReaderConfig("scheduledSyncInterval") || "0"
      );
      if (!currentInterval || currentInterval <= 0) {
        clearInterval(this.scheduledSyncTimer);
        this.scheduledSyncTimer = null;
        return;
      }
      const defaultSyncOption = ConfigService.getItem("defaultSyncOption");
      if (
        !defaultSyncOption ||
        ConfigService.getReaderConfig("isDisableAutoSync") === "yes"
      ) {
        return;
      }
      if (!this.state.isSync && !this.isSyncing) {
        const userInfo = await this.props.handleFetchUserInfo();
        await this.handleCloudSync(userInfo);
      }
    }, intervalMs);
  };
  async UNSAFE_componentWillReceiveProps(
    nextProps: Readonly<HeaderProps>,
    _nextContext: any
  ) {
    if (nextProps.isAuthed && nextProps.isAuthed !== this.props.isAuthed) {
      addChatBox();
      if (ConfigService.getReaderConfig("isProUpgraded") !== "yes") {
        try {
          ConfigService.setReaderConfig("isProUpgraded", "yes");
          await generateSyncRecord();
        } catch (error) {
          console.error(error);
        }
      }
      let userInfo = await this.props.handleFetchUserInfo();
      if (
        !isSelfHostedOfflineFirst() &&
        ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
        ConfigService.getItem("defaultSyncOption")
      ) {
        this.setState({ isSync: true });
        await this.handleCloudSync(userInfo);
        await this.handleOpenLastReadBook();
      }
    }
    if (!nextProps.isAuthed && nextProps.isAuthed !== this.props.isAuthed) {
      removeChatBox();
    }
  }
  handleOpenLastReadBook = async () => {
    if (
      ConfigService.getReaderConfig("isOpenBook") === "yes" &&
      !this.props.currentBook.key
    ) {
      let lastReadBookKey = ConfigService.getAllListConfig("recentBooks")[0];
      if (lastReadBookKey) {
        let fullBook = await DatabaseService.getRecord(
          lastReadBookKey,
          "books"
        );
        if (fullBook) {
          this.props.handleReadingBook(fullBook);
          BookUtil.redirectBook(fullBook);
        }
      }
    }
  };
  handleFinishReading = async () => {
    if (
      ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
      !isSelfHostedOfflineFirst() &&
      ConfigService.getItem("defaultSyncOption") &&
      !this.state.isSync
    ) {
      ConfigService.setItem("isFinshReading", "yes");
      let userInfo = await this.props.handleFetchUserInfo();
      this.setState({ isSync: true }, async () => {
        await this.handleCloudSync(userInfo);
        ConfigService.setItem("isFinshReading", "no");
      });
    }
  };
  handleFinishUpgrade = () => {
    setTimeout(() => {
      if (this.props.mode === "home") {
        this.props.history.push("/manager/home");
      }
    }, 2000);
  };

  syncFromLocation = async () => {
    let result = await restoreFromConfigJson();
    if (result) {
      this.setState({ isDataChange: false });
      //Check for data update
      let lastSyncTime = getLastSyncTimeFromConfigJson();
      if (ConfigService.getItem("lastSyncTime") && lastSyncTime) {
        ConfigService.setItem("lastSyncTime", lastSyncTime + "");
      } else {
        let timestamp = new Date().getTime().toString();
        ConfigService.setItem("lastSyncTime", timestamp);
      }
    }
    if (!result) {
      toast.error(this.props.t("Sync failed"));
    } else {
      toast.success(
        this.props.t("Synchronisation successful") +
          " (" +
          this.props.t("Local") +
          ")"
      );
      toast.success(
        this.props.t(
          "Your data has been imported from your local folder, Upgrade to pro to get more advanced features"
        ),
        {
          duration: 4000,
        }
      );
    }
  };
  handleLocalSync = async () => {
    let lastSyncTime = getLastSyncTimeFromConfigJson();
    if (!lastSyncTime) {
      await this.syncToLocation();
    } else {
      if (
        ConfigService.getItem("lastSyncTime") &&
        lastSyncTime <= parseInt(ConfigService.getItem("lastSyncTime")!)
      ) {
        await this.syncToLocation();
      } else {
        await this.syncFromLocation();
      }
    }

    this.setState({ isSync: false });
  };
  handleKOReaderSync = async () => {
    if (!isKOReaderSyncEnabled()) {
      return;
    }

    toast.loading(this.props.t("Start syncing") + " (KOReader)", {
      id: "koreader-sync",
      position: "bottom-center",
    });
    try {
      const summary = await syncKOReaderProgress();
      if (summary.pulledBooks > 0 || summary.pushedBooks > 0) {
        this.props.handleFetchBooks();
      }
      toast.success(
        this.props.t("Synchronisation successful") + " (KOReader)",
        {
          id: "koreader-sync",
        }
      );
    } catch (error) {
      console.error(error);
      toast.error(
        this.props.t("Sync failed") +
          " (KOReader): " +
          (error instanceof Error ? error.message : String(error)),
        {
          id: "koreader-sync",
          duration: 6000,
        }
      );
    }
  };
  beforeSync = async (userInfo: any) => {
    if (!ConfigService.getItem("defaultSyncOption")) {
      toast.error(this.props.t("Please add data source in the setting"));
      return false;
    }
    if (
      ConfigService.getReaderConfig("isEnableKoodoSync") === "yes" &&
      userInfo &&
      userInfo.default_sync_option &&
      userInfo.default_sync_option !== this.props.defaultSyncOption
    ) {
      toast.error(
        this.props.t(
          "The default sync options in the local and cloud are inconsistent, please set the local default sync option to "
        ) +
          this.props.t(
            driveList.find(
              (item) => item.value === userInfo.default_sync_option
            )?.label || ""
          ),
        {
          duration: 4000,
        }
      );
      return false;
    }
    let config = await getCloudConfig(
      ConfigService.getItem("defaultSyncOption") || ""
    );
    if (Object.keys(config).length === 0) {
      toast.error(this.props.t("Cannot get sync config"));
      return false;
    }
    if (
      ConfigService.getItem("defaultSyncOption") === "google" &&
      !config.version
    ) {
      let targetDrive = "google";
      await TokenService.setToken(targetDrive + "_token", "");
      SyncService.removeSyncUtil(targetDrive);
      removeCloudConfig(targetDrive);
      ConfigService.deleteListConfig(targetDrive, "dataSourceList");
      this.props.handleFetchDataSourceList();
      if (targetDrive === ConfigService.getItem("defaultSyncOption")) {
        ConfigService.removeItem("defaultSyncOption");
        this.props.handleFetchDefaultSyncOption();
      }
      if (ConfigService.getReaderConfig("isEnableKoodoSync") === "yes") {
        resetKoodoSync();
      }
      toast(
        this.props.t(
          "In order to let you directly manage your data in Google Drive, we have deprecated the old Google Drive token. Please reauthorize Google Drive in the settings. Your new data will be stored in the root directory of your Google Drive, and you can manage it directly in the Google Drive web interface."
        ),
        { duration: 4000 }
      );
      return false;
    }
    await checkMissingBook();
    let checkResult = await checkBrokenDatabase();
    if (checkResult) {
      toast.error(
        this.props.t(
          "Broken data detected, please click the setting button to reset the sync records"
        )
      );
      return false;
    }
    if (ConfigService.getReaderConfig("isEnableKoodoSync") !== "yes") {
      toast.loading(
        this.props.t("Start syncing") +
          " (" +
          this.props.t(
            driveList.find(
              (item) =>
                item.value === ConfigService.getItem("defaultSyncOption")
            )?.label || ""
          ) +
          ")",
        { id: "syncing", position: "bottom-center" }
      );
    }

    return true;
  };
  getCompareResult = async () => {
    let localSyncRecords = ConfigService.getAllSyncRecord();
    let cloudSyncRecords = await ConfigUtil.getCloudConfig("sync");
    return await SyncHelper.compareAll(
      localSyncRecords,
      cloudSyncRecords,
      ConfigService,
      TokenService,
      ConfigUtil
    );
  };
  handleSyncStateChange = (isSyncing: boolean) => {
    this.setState({ isSync: isSyncing });
  };
  handleCloudSync = async (userInfo: any): Promise<false | undefined> => {
    if (this.isSyncing) {
      console.info("Sync already in progress, skipping...");
      return false;
    }
    this.isSyncing = true;

    try {
      this.timer = await showTaskProgress(this.handleSyncStateChange);
      if (!this.timer) {
        this.setState({ isSync: false });
        this.handleKOReaderSync();
        return false;
      }

      let res = await this.beforeSync(userInfo);
      if (!res) {
        clearInterval(this.timer);
        this.setState({ isSync: false });
        this.handleKOReaderSync();
        return false;
      }
      let compareResult = await this.getCompareResult();
      await this.handleSync(compareResult);
      clearInterval(this.timer);
      this.setState({ isSync: false });
      this.handleKOReaderSync();
    } catch (error) {
      console.error(error);
      toast.error(
        this.props.t("Sync failed") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
      clearInterval(this.timer);
      this.setState({ isSync: false });
      this.handleKOReaderSync();
      return false;
    } finally {
      this.isSyncing = false;
    }
    setTimeout(() => {
      toast.dismiss("syncing");
    }, 3000);
    return;
  };
  handleSuccess = async () => {
    this.props.handleFetchBooks();

    this.props.handleFetchBookmarks();
    this.props.handleFetchNotes();

    toast.success(this.props.t("Synchronisation successful"), {
      id: "syncing",
    });

    if (
      ConfigService.getItem("defaultSyncOption") === "adrive" &&
      ConfigService.getReaderConfig("hasShowAliyunWarning") !== "yes"
    ) {
      ConfigService.setReaderConfig("hasShowAliyunWarning", "yes");
      toast.success(
        this.props.t(
          "We have bypassed the synchronization of book cover for Aliyun Drive, covers will be downloaded automatically when you open the book next time."
        ),
        {
          duration: 4000,
        }
      );
    }
    if (ConfigService.getReaderConfig("isEnableKoodoSync") === "yes") {
      ConfigUtil.updateSyncData();
    }
    //when book is empty, need to refresh the book list
    setTimeout(async () => {
      if (this.props.mode === "home") {
        this.props.history.push("/manager/home");
        if (
          ConfigService.getReaderConfig("isFirstSync") !== "no" &&
          ConfigService.getReaderConfig("isEnableKoodoSync") !== "yes" &&
          this.props.defaultSyncOption !== "webdav" &&
          this.props.defaultSyncOption !== "ftp" &&
          this.props.defaultSyncOption !== "sftp" &&
          this.props.defaultSyncOption !== "smb" &&
          this.props.defaultSyncOption !== "s3compatible" &&
          this.props.defaultSyncOption !== "icloud" &&
          this.props.defaultSyncOption !== "docker"
        ) {
          ConfigService.setReaderConfig("isFirstSync", "no");
          let result = await vexComfirmAsync(
            `<h3>${this.props.t("Enable Koodo Sync")}</h3><p>${
              this.props.t(
                "To enjoy a faster and seamless synchronization experience."
              ) +
              " " +
              this.props.t(
                "Your reading progress, notes, highlights, bookmarks, and other data will be stored and synced through our cloud service. Your books and covers will still be synced by your added data sources. All your data will be encrypted and stored securely in our cloud. You can disable this feature anytime in the settings."
              )
            }</p>`
          );
          if (result) {
            ConfigService.setReaderConfig("isEnableKoodoSync", "yes");
            let encryptedToken = await TokenService.getToken(
              this.props.defaultSyncOption + "_token"
            );
            await updateUserConfig({
              is_enable_koodo_sync: "yes",
              default_sync_option: this.props.defaultSyncOption,
              default_sync_token: encryptedToken || "",
            });
            let userInfo = await this.props.handleFetchUserInfo();
            toast.success(this.props.t("Setup successful"));
            this.handleCloudSync(userInfo);
          }
        }
      }
    }, 1000);
  };
  handleSync = async (compareResult) => {
    try {
      let tasks = await SyncHelper.startSync(
        compareResult,
        ConfigService,
        DatabaseService,
        ConfigUtil,
        BookUtil,
        CoverUtil
      );
      await SyncHelper.runTasksWithLimit(
        tasks,
        99,
        ConfigService.getItem("defaultSyncOption")
      );

      clearInterval(this.timer);
      this.setState({ isSync: false });
      let stats = await getTaskStats();
      if (stats.hasFailedTasks) {
        toast.error(
          this.props.t(
            "Tasks failed after multiple retries, please check the network connection or reauthorize the data source in the settings"
          ),
          {
            id: "syncing",
            duration: 6000,
          }
        );
        return;
      }
      toast.loading(this.props.t("Almost finished"), {
        id: "syncing",
        position: "bottom-center",
      });
      await this.handleSuccess();
    } catch (error) {
      console.error(error);
      clearInterval(this.timer);
      this.setState({ isSync: false });
      toast.error(
        this.props.t("Sync failed") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );

      return;
    }
  };
  syncToLocation = async () => {
    let timestamp = new Date().getTime().toString();
    ConfigService.setItem("lastSyncTime", timestamp);
    await backupToConfigJson();
    toast.success(
      this.props.t("Synchronisation successful") +
        " (" +
        this.props.t("Local") +
        ")"
    );
    toast.success(
      this.props.t(
        "Your data has been exported to your local folder, learn how to sync your data to your other devices by visiting our documentation, Upgrade to pro to get more advanced features"
      ),
      {
        duration: 4000,
      }
    );
  };

  render() {
    return (
      <div
        className="header"
        style={this.props.isCollapsed ? { marginLeft: "40px" } : {}}
      >
        <div
          className="header-search-container"
          style={this.props.isCollapsed ? { width: "369px" } : {}}
        >
          <SearchBox />
        </div>
        <div
          className="setting-icon-parrent"
          style={this.props.isCollapsed ? { marginLeft: "430px" } : {}}
        >
          <div
            className="setting-icon-container"
            onClick={() => {
              this.props.handleSortDisplay(!this.props.isSortDisplay);
            }}
            onMouseLeave={() => {
              this.props.handleSortDisplay(false);
            }}
            style={{ top: "18px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Sort by")}
              data-tooltip-place="left"
            >
              <span className="icon-sort-desc header-sort-icon"></span>
            </span>
          </div>
          <div
            className="setting-icon-container"
            onClick={() => {
              this.props.handleSetting(true);
              this.props.handleAbout(false);
            }}
            onMouseLeave={() => {
              this.props.handleAbout(false);
            }}
            style={{ marginTop: "2px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Setting")}
              data-tooltip-place="left"
            >
              <span className="icon-setting setting-icon"></span>
            </span>
          </div>
          <div
            className="setting-icon-container"
            onClick={() => {
              this.props.handleBackupDialog(true);
            }}
            onMouseLeave={() => {
              this.props.handleSortDisplay(false);
            }}
            style={{ marginTop: "1px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Backup")}
              data-tooltip-place="left"
            >
              <span className="icon-archive header-archive-icon"></span>
            </span>
          </div>

          <div
            className="setting-icon-container"
            onClick={async () => {
              if (isSelfHostedOfflineFirst()) {
                toast(this.props.t("All books are stored locally on this device"));
                return;
              }
              if (!this.props.isAuthed) {
                toast(
                  this.props.t("Please upgrade to Pro to use this feature")
                );
                this.props.handleSetting(true);
                this.props.handleSettingMode("account");
                return;
              }
              this.setState({ isSync: true });
              if (this.props.isAuthed) {
                let userInfo = await this.props.handleFetchUserInfo();
                await this.handleCloudSync(userInfo);
              } else {
                await this.handleLocalSync();
                this.handleKOReaderSync();
              }
            }}
            style={{ marginTop: "2px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Sync")}
              data-tooltip-place="left"
            >
              <span
                className={
                  "icon-sync setting-icon" +
                  (this.state.isSync ? " icon-rotate" : "")
                }
                style={
                  this.state.isDataChange ? { color: "rgb(35, 170, 242)" } : {}
                }
              ></span>
            </span>
          </div>
        </div>

        {!this.props.isAuthed && !this.state.isHidePro ? (
          <div className="header-report-container">
            <span
              style={{ textDecoration: "underline" }}
              onClick={() => {
                if (
                  window.location.hostname !== "web.koodoreader.com"
                ) {
                  this.props.handleSetting(true);
                  this.props.handleSettingMode("account");
                  return;
                }
                this.props.history.push("/login");
              }}
            >
              <Trans>Pro version</Trans>
              <span> </span>
            </span>

            <span
              className="icon-close icon-pro-close"
              onClick={() => {
                ConfigService.setReaderConfig("isHidePro", "yes");
                this.setState({ isHidePro: true });
              }}
            ></span>
          </div>
        ) : null}
        {this.props.isAuthed &&
        this.props.userInfo &&
        ((this.props.userInfo.type === "pro" &&
          this.props.userInfo.valid_until <
            new Date().getTime() / 1000 + 30 * 24 * 3600) ||
          (this.props.userInfo.type === "trial" &&
            this.props.userInfo.valid_until <
              new Date().getTime() / 1000 + 3 * 24 * 3600)) ? (
          <div className="header-report-container">
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={i18n.t("Your trial will expire in", {
                ttl: Math.ceil(
                  (this.props.userInfo.valid_until -
                    new Date().getTime() / 1000) /
                    (24 * 3600)
                ),
              })}
            >
              <span
                style={{ textDecoration: "underline" }}
                onClick={async () => {
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
                  } else if (response.code === 401) {
                    this.props.handleFetchAuthed();
                  }
                }}
              >
                <Trans>Renew Pro</Trans>
              </span>
            </span>
          </div>
        ) : null}
        {this.props.isAuthed &&
        this.props.userInfo &&
        this.props.userInfo.type === "trial" &&
        this.props.userInfo.valid_until >
          new Date().getTime() / 1000 + 3 * 24 * 3600 ? (
          <div className="header-report-container">
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={i18n.t("Your trial will expire in", {
                ttl: Math.ceil(
                  (this.props.userInfo.valid_until -
                    new Date().getTime() / 1000) /
                    (24 * 3600)
                ),
              })}
            >
              <span
                style={{ textDecoration: "underline" }}
                onClick={async () => {
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
                  } else if (response.code === 401) {
                    this.props.handleFetchAuthed();
                  }
                }}
              >
                <Trans>In trial</Trans>
              </span>
            </span>
          </div>
        ) : null}
        <ImportLocal
          {...({
            handleDrag: this.props.handleDrag,
          } as any)}
        />
        <SupportDialog />
        <UpdateInfo />
      </div>
    );
  }
}

export default Header;
