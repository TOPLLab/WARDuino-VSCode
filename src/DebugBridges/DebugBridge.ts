import { VariableInfo } from "../State/VariableInfo";
import { WOODState } from "../State/WOODState";
import { SourceMap } from "../State/SourceMap";
import { ProxyCallItem } from "../Views/ProxyCallsProvider";
import { RuntimeState } from "../State/RuntimeState";
import { Breakpoint, BreakpointPolicy } from "../State/Breakpoint";
import { DebugBridgeListener } from "./DebugBridgeListener";
import { DebuggingTimeline } from "../State/DebuggingTimeline";

export interface DebugBridge {

  requestMissingState(): void;

  refreshViews(): void;

  connect(): Promise<string>;

  getDebuggingTimeline(): DebuggingTimeline;

  getCurrentState(): RuntimeState | undefined;

  updateRuntimeState(runtimeState: RuntimeState, refreshViews?: boolean): void;


  getBreakpointPossibilities(): Breakpoint[];


  step(): void;

  stepBack(): void;

  run(): void;

  pause(): void;

  hitBreakpoint(): void;

  pullSession(): void;

  pushSession(woodState: WOODState): void;


  popEvent(): void;

  // Adds or removes the current callback depending on whether is selected or not respectively
  updateSelectedProxies(proxy: ProxyCallItem): void;

  setSelectedProxies(proxies: Set<ProxyCallItem>): void;

  getSelectedProxies(): Set<ProxyCallItem>;

  setBreakPoints(lines: number[]): Breakpoint[];

  unsetAllBreakpoints(): void;

  unsetBreakPoint(breakpoint: Breakpoint | number): void;

  refresh(): void;

  notifyNewEvent(): void;

  disconnect(): void;


  upload(): void;

  updateModule(wasm: Buffer): void;

  updateSourceMapper(newSourceMap: SourceMap): void;

  updateLocal(local: VariableInfo): Promise<string>;

  updateGlobal(updateGlobal: VariableInfo): Promise<string>;

  getBreakpointPolicy(): BreakpointPolicy;

  setBreakpointPolicy(policy: BreakpointPolicy): void;

  getListener(): DebugBridgeListener;

}