import React from "react";
import "./background.css";
import { BackgroundProps, BackgroundState } from "./interface";
import {
  ConfigService,
  KookitConfig,
} from "../../assets/lib/kookit-extra-browser.min";
import { Trans } from "react-i18next";
import { getBatchTrans, getWordDefinitions } from "../../utils/request/reader";
import { detectLocalLanguage } from "../../utils/common";
import toast from "react-hot-toast";

const BATCH_TRANSLATION_STABLE_DELAY = 1000;
const BATCH_TRANSLATION_MAX_RETRIES = 3;
const BATCH_TRANSLATION_RETRY_DELAYS = [1200, 2500, 5000];

type BatchTranslationJob = {
  requestId: number;
  rendition: any;
  texts: string[];
  targetLang: string;
  retryCount: number;
};

class Background extends React.Component<BackgroundProps, BackgroundState> {
  isFirst: Boolean;
  timeInterval: any;
  lastBatchTranslationTriggerAt: number;
  batchTranslationLock: Promise<any>;
  batchTranslationResultCache: Map<string, string>;
  batchTranslationDebounceTimer: any;
  batchTranslationRetryTimers: any[];
  batchTranslationRequestId: number;
  pendingBatchTranslationJob: BatchTranslationJob | null;
  isBatchTranslationWorkerRunning: boolean;
  constructor(props: any) {
    super(props);
    this.state = {
      isSingle: this.props.readerMode !== "double",
      prevPage: 0,
      nextPage: 0,
      currentTime: this.getFormattedTime(),
      percentage: "",
    };
    this.isFirst = true;
    this.lastBatchTranslationTriggerAt = 0;
    this.batchTranslationLock = Promise.resolve();
    this.batchTranslationResultCache = new Map();
    this.batchTranslationDebounceTimer = null;
    this.batchTranslationRetryTimers = [];
    this.batchTranslationRequestId = 0;
    this.pendingBatchTranslationJob = null;
    this.isBatchTranslationWorkerRunning = false;
  }

  getFormattedTime() {
    const now = new Date();
    return (
      now.getHours().toString().padStart(2, "0") +
      ":" +
      now.getMinutes().toString().padStart(2, "0")
    );
  }

  async componentDidMount() {
    this.timeInterval = setInterval(() => {
      this.setState({ currentTime: this.getFormattedTime() });
    }, 10000);
  }

  componentWillUnmount() {
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
    if (this.batchTranslationDebounceTimer) {
      clearTimeout(this.batchTranslationDebounceTimer);
    }
    this.clearBatchTranslationRetryTimers();
    this.pendingBatchTranslationJob = null;
  }

  async UNSAFE_componentWillReceiveProps(nextProps: BackgroundProps) {
    if (nextProps.htmlBook !== this.props.htmlBook && nextProps.htmlBook) {
      await this.handlePageNum(nextProps.htmlBook.rendition);
      nextProps.htmlBook.rendition.on("page-changed", async () => {
        await this.handlePageNum(nextProps.htmlBook.rendition);
        this.handleBatchTranslation(nextProps.htmlBook.rendition);
      });
      nextProps.htmlBook.rendition.on("rendered", async () => {
        await this.handlePageNum(nextProps.htmlBook.rendition);
        this.handleBatchTranslation(nextProps.htmlBook.rendition);
        await this.handleWordDefinition(nextProps.htmlBook.rendition);
      });
    }
    if (nextProps.readerMode !== this.props.readerMode) {
      this.setState({ isSingle: nextProps.readerMode !== "double" });
    }
  }
  hashBatchTranslationText(text: string) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36) + "-" + text.length.toString(36);
  }

  normalizeBatchTranslationText(text: string) {
    return (text || "")
      .normalize("NFKC")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  getBatchTranslationTargetLang() {
    return KookitConfig.ConvertLangMap[
      ConfigService.getReaderConfig("lang") || "zhCN"
    ];
  }

  getBatchTranslationMemoryKey(text: string, targetLang: string) {
    const modelKey = ConfigService.getReaderConfig("aiTranslateModel") || "";
    const modelConfig =
      ConfigService.getObjectConfig(modelKey, "aiModelConfig", null)?.config ||
      {};
    const prompt =
      ConfigService.getReaderConfig("aiTranslatePrompt") ||
      KookitConfig.DefaultPrompts.aiTranslate ||
      "";
    const scope = [
      this.props.currentBook.key,
      targetLang,
      modelKey,
      modelConfig.endpoint || "",
      modelConfig.providerId || "",
      modelConfig.modelId || "",
      this.hashBatchTranslationText(prompt),
    ].join(":");
    return [
      scope,
      this.hashBatchTranslationText(this.normalizeBatchTranslationText(text)),
    ].join(":");
  }

  getCachedBatchTranslation(text: string, targetLang: string) {
    const normalizedText = this.normalizeBatchTranslationText(text);
    if (!normalizedText) return "";
    return (
      this.batchTranslationResultCache.get(
        this.getBatchTranslationMemoryKey(text, targetLang)
      ) || ""
    );
  }

  setCachedBatchTranslation(
    text: string,
    translatedText: string,
    targetLang: string
  ) {
    const normalizedText = this.normalizeBatchTranslationText(text);
    if (!normalizedText || !translatedText) return;
    this.batchTranslationResultCache.set(
      this.getBatchTranslationMemoryKey(text, targetLang),
      translatedText
    );
  }

  clearBatchTranslationRetryTimers() {
    this.batchTranslationRetryTimers.forEach((timer) => clearTimeout(timer));
    this.batchTranslationRetryTimers = [];
  }

  isBatchTranslationEnabled() {
    if (
      !ConfigService.getAllListConfig("fullTranslationBooks").includes(
        this.props.currentBook.key
      ) ||
      ConfigService.getReaderConfig("fullTranslationMode") === "no" ||
      !this.props.isAuthed
    ) {
      return false;
    }
    return true;
  }

  applyCachedBatchTranslations(
    rendition: any,
    batchTransTexts: string[],
    targetLang: string,
    requestId: number
  ) {
    const cachedTexts: string[] = [];
    const cachedTranslations: string[] = [];
    const missingTexts: string[] = [];

    batchTransTexts.forEach((text: string) => {
      const cachedTranslation = this.getCachedBatchTranslation(
        text,
        targetLang
      );
      if (cachedTranslation) {
        cachedTexts.push(text);
        cachedTranslations.push(cachedTranslation);
      } else {
        missingTexts.push(text);
      }
    });

    if (
      cachedTexts.length > 0 &&
      requestId === this.batchTranslationRequestId
    ) {
      rendition.handleBatchTransResult(cachedTexts, cachedTranslations);
    }

    return missingTexts;
  }

  async prepareCurrentBatchTranslationJob(
    rendition: any,
    requestId: number,
    retryCount = 0
  ) {
    if (!this.isBatchTranslationEnabled()) {
      return null;
    }
    if (requestId !== this.batchTranslationRequestId) {
      return null;
    }

    const batchTransTexts = await rendition.getBatchTransTexts();
    if (
      requestId !== this.batchTranslationRequestId ||
      !batchTransTexts ||
      batchTransTexts.length === 0
    ) {
      return null;
    }

    const targetLang = this.getBatchTranslationTargetLang();
    const missingTexts = this.applyCachedBatchTranslations(
      rendition,
      batchTransTexts,
      targetLang,
      requestId
    );

    if (missingTexts.length === 0) {
      return null;
    }

    return {
      requestId,
      rendition,
      texts: missingTexts,
      targetLang,
      retryCount,
    };
  }

  async enqueueCurrentBatchTranslation(
    rendition: any,
    requestId: number,
    retryCount = 0
  ) {
    const job = await this.prepareCurrentBatchTranslationJob(
      rendition,
      requestId,
      retryCount
    );
    if (!job) {
      return;
    }

    this.pendingBatchTranslationJob = job;
    this.runBatchTranslationWorker();
  }

  scheduleBatchTranslationRetry(job: BatchTranslationJob) {
    if (
      job.requestId !== this.batchTranslationRequestId ||
      job.retryCount >= BATCH_TRANSLATION_MAX_RETRIES
    ) {
      return;
    }

    const delay =
      BATCH_TRANSLATION_RETRY_DELAYS[job.retryCount] ||
      BATCH_TRANSLATION_RETRY_DELAYS[
        BATCH_TRANSLATION_RETRY_DELAYS.length - 1
      ];
    const timer = setTimeout(() => {
      this.batchTranslationRetryTimers = this.batchTranslationRetryTimers.filter(
        (item) => item !== timer
      );
      if (job.requestId !== this.batchTranslationRequestId) {
        return;
      }
      this.enqueueCurrentBatchTranslation(
        job.rendition,
        job.requestId,
        job.retryCount + 1
      );
    }, delay);
    this.batchTranslationRetryTimers.push(timer);
  }

  async runBatchTranslationWorker() {
    if (this.isBatchTranslationWorkerRunning) {
      return;
    }
    this.isBatchTranslationWorkerRunning = true;

    try {
      while (this.pendingBatchTranslationJob) {
        const job = this.pendingBatchTranslationJob;
        this.pendingBatchTranslationJob = null;
        await this.executeBatchTranslationJob(job);
      }
    } finally {
      this.isBatchTranslationWorkerRunning = false;
      if (this.pendingBatchTranslationJob) {
        this.runBatchTranslationWorker();
      }
    }
  }

  async executeBatchTranslationJob(job: BatchTranslationJob) {
    const run = async () => {
      if (job.requestId !== this.batchTranslationRequestId) {
        return;
      }

      const stillMissingTexts: string[] = [];
      const newlyCachedTexts: string[] = [];
      const newlyCachedTranslations: string[] = [];

      job.texts.forEach((text: string) => {
        const cachedTranslation = this.getCachedBatchTranslation(
          text,
          job.targetLang
        );
        if (cachedTranslation) {
          newlyCachedTexts.push(text);
          newlyCachedTranslations.push(cachedTranslation);
        } else {
          stillMissingTexts.push(text);
        }
      });

      if (
        newlyCachedTexts.length > 0 &&
        job.requestId === this.batchTranslationRequestId
      ) {
        job.rendition.handleBatchTransResult(
          newlyCachedTexts,
          newlyCachedTranslations
        );
      }
      if (stillMissingTexts.length === 0) {
        return;
      }

      try {
        const res = await getBatchTrans(
          stillMissingTexts,
          "Automatic",
          job.targetLang,
          { bookKey: this.props.currentBook.key }
        );

        if (
          res &&
          res.code === 200 &&
          res.data &&
          Array.isArray(res.data.texts) &&
          res.data.texts.length === stillMissingTexts.length
        ) {
          res.data.texts.forEach((translatedText: string, index: number) => {
            this.setCachedBatchTranslation(
              stillMissingTexts[index],
              translatedText,
              job.targetLang
            );
          });
          if (job.requestId === this.batchTranslationRequestId) {
            job.rendition.handleBatchTransResult(
              stillMissingTexts,
              res.data.texts
            );
          }
        } else {
          this.scheduleBatchTranslationRetry(job);
        }
      } catch (error) {
        console.error("Batch translation failed:", error);
        this.scheduleBatchTranslationRetry(job);
      }
    };

    const next = this.batchTranslationLock.then(run, run);
    this.batchTranslationLock = next.catch(() => {});
    return next;
  }

  handleBatchTranslation(rendition) {
    if (!this.isBatchTranslationEnabled()) {
      return;
    }

    this.batchTranslationRequestId += 1;
    const requestId = this.batchTranslationRequestId;
    this.pendingBatchTranslationJob = null;
    this.clearBatchTranslationRetryTimers();

    if (this.batchTranslationDebounceTimer) {
      clearTimeout(this.batchTranslationDebounceTimer);
    }
    this.batchTranslationDebounceTimer = setTimeout(() => {
      this.enqueueCurrentBatchTranslation(rendition, requestId);
    }, BATCH_TRANSLATION_STABLE_DELAY);
  }
  async handleWordDefinition(rendition) {
    const prev = this.batchTranslationLock;
    const next = prev.then(async () => {
      if (
        !ConfigService.getAllListConfig("wordDefinitionBooks").includes(
          this.props.currentBook.key
        ) ||
        !this.props.isAuthed
      ) {
        return;
      }

      let wordTexts = await rendition.audioText();
      if (wordTexts && wordTexts.length > 0) {
        let lang = detectLocalLanguage(wordTexts.slice(0, 500).join(" "));
        if (lang === "ko") {
          toast.error(
            this.props.t(
              "Unsupported language for word definition, currently only Chinese, Japanese and English are supported"
            )
          );
          return;
        }
        let currentLevel =
          lang === "zh"
            ? ConfigService.getReaderConfig("currentChineseLevel") || "HSK3"
            : lang === "ja"
              ? ConfigService.getReaderConfig("currentJapaneseLevel") || "N3"
              : ConfigService.getReaderConfig("currentEnglishLevel") || "四级";
        let res = await getWordDefinitions(wordTexts, currentLevel, lang);

        if (res && res.data && res.data.results) {
          rendition.handleWordDefinitionResult(
            res.data.results,
            lang,
            ConfigService.getReaderConfig("lang")
          );
        }
      }
    });
    this.batchTranslationLock = next.catch(() => {});
    return next;
  }
  async handlePageNum(rendition) {
    let pageInfo = await rendition.getProgress();
    if (
      this.props.currentBook.format === "PDF" &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(
        this.props.currentBook.key
      )
    ) {
      this.setState({
        prevPage: pageInfo.currentPage,
        nextPage: pageInfo.currentPage + 1,
        percentage: pageInfo.percentage,
      });
      return;
    }
    this.setState({
      prevPage: this.state.isSingle
        ? pageInfo.currentPage
        : pageInfo.currentPage * 2 - 1,
      nextPage: this.state.isSingle
        ? pageInfo.currentPage
        : pageInfo.currentPage * 2,
      percentage: pageInfo.percentage,
    });
  }

  render() {
    return (
      <div
        className="background"
        style={{
          color: ConfigService.getReaderConfig("textColor")
            ? ConfigService.getReaderConfig("textColor")
            : "",
          width:
            !this.props.isNavLocked && !this.props.isSettingLocked
              ? "100%"
              : this.props.isNavLocked && this.props.isSettingLocked
                ? "calc(100% - 600px)"
                : "calc(100% - 300px)",
          left: !this.props.isNavLocked ? "0" : "300px",
          right: !this.props.isSettingLocked ? "0" : "300px",
          backgroundColor: this.props.backgroundColor,
          filter: `brightness(${
            ConfigService.getReaderConfig("brightness") || 1
          }) invert(${
            ConfigService.getReaderConfig("isInvert") === "yes" ? 1 : 0
          })`,
        }}
      >
        <div className="header-container">
          {!this.props.isHideHeader && this.props.currentChapter + "" && (
            <p
              className="header-chapter-name"
              style={
                this.state.isSingle
                  ? {
                      left: `calc(50vw - 
                      270px)`,
                    }
                  : {}
              }
            >
              {this.props.currentChapter}
            </p>
          )}
          {!this.props.isHideHeader &&
            this.props.currentChapter + "" &&
            !this.state.isSingle && (
              <p
                className="header-book-name"
                style={
                  this.state.isSingle
                    ? {
                        right: `calc(50vw - 
                      270px)`,
                      }
                    : {}
                }
              >
                {this.props.currentBook.name}
              </p>
            )}
          {!this.props.isHideHeader && (
            <>
              <span className="footer-time">
                {this.state.currentTime}
                {this.state.percentage
                  ? "  " +
                    (parseFloat(this.state.percentage) * 100).toFixed(2) +
                    "%"
                  : ""}
              </span>
            </>
          )}
        </div>
        <div className="footer-container">
          {!this.props.isHideFooter && this.state.prevPage > 0 && (
            <p
              className="background-page-left"
              style={
                this.state.isSingle
                  ? {
                      left: `calc(50vw - 
                      270px)`,
                    }
                  : {}
              }
            >
              <Trans i18nKey="Book page" count={this.state.prevPage}>
                Page
                {{
                  count: this.state.prevPage,
                }}
              </Trans>
            </p>
          )}
          {!this.props.isHideFooter &&
            this.state.nextPage > 0 &&
            !this.state.isSingle && (
              <p className="background-page-right">
                <Trans i18nKey="Book page" count={this.state.nextPage}>
                  Page
                  {{
                    count: this.state.nextPage,
                  }}
                </Trans>
              </p>
            )}
        </div>
        <>
          {this.props.isShowBookmark ? <div className="bookmark"></div> : null}
        </>
        {this.props.isShowPageBorder && (
          <>
            <div className="page-border"></div>
            <div className="inner-page-border"></div>
            <div className="page-border-header-line"></div>
            <div className="page-border-footer-line"></div>
            {!this.state.isSingle && (
              <div
                className="page-border-center-line"
                style={
                  this.props.textOrientation === "vertical"
                    ? {
                        top: "50%",
                        height: "1px",
                        width: "calc(100% - 30px)",
                        left: "15px",
                        right: "15px",
                      }
                    : {}
                }
              ></div>
            )}
          </>
        )}
      </div>
    );
  }
}

export default Background;
