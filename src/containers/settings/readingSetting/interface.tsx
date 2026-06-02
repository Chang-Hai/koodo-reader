import { RouteComponentProps } from "react-router-dom";
export interface SettingInfoProps extends RouteComponentProps<any> {
  handleSetting: (isSettingOpen: boolean) => void;
  handleSettingMode: (settingMode: string) => void;
  t: (title: string) => string;
  isAuthed: boolean;
}
export interface SettingInfoState {
  isTouch: boolean;
  isPreventTrigger: boolean;
  isOpenBook: boolean;
  isDisablePopup: boolean;
  isDisableAutoScroll: boolean;
  isManualScroll: boolean;
  isDisableTrashBin: boolean;
  isDeleteShelfBook: boolean;
  isPrecacheBook: boolean;
  isOverwriteLink: boolean;
  isOverwriteText: boolean;
  isHideShelfBook: boolean;
  isLemmatizeWord: boolean;
}
