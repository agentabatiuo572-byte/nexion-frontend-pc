export type ModuleHealthSnapshot = {
  text: string;
  headingCount: number;
  landmarkCount: number;
  controlCount: number;
  visibleLoadingCount: number;
  alertTexts: string[];
  semanticErrorScanComplete: boolean;
  terminalErrorMarkerCount: number;
  unmarkedBusinessErrorTexts: string[];
};

export {
  evaluateModuleHealthSnapshot,
  fatalModuleTextPatterns,
  isUnmarkedBusinessErrorText,
} from "./pc-module-health-contract.mjs";
