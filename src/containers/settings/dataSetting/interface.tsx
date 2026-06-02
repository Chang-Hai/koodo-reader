import { RouteComponentProps } from "react-router-dom";
export interface SettingInfoProps extends RouteComponentProps<any> {
  t: (title: string) => string;
  isAuthed: boolean;
  handleFetchBooks: () => void;
}
export interface SettingInfoState {
  storageLocation: string;
  snapshotList: { file: string; time: number }[];
  exportNotesFormat: string;
  exportHighlightsFormat: string;
  isEnableKoReaderSync: boolean;
  isEnableNotionSync: boolean;
  isEnableYuqueSync: boolean;
  isEnableReadwiseSync: boolean;
  isEnableEudicSync: boolean;
  isEnableAnkiSync: boolean;
  [key: string]: any;
}
