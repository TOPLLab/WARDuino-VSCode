import { VariableInfo } from "../State/VariableInfo";
import { WOODState } from "../State/WOODState";
import { SourceMap } from "../State/SourceMap";
import { ProxyCallItem } from "../Views/ProxyCallsProvider";
import { RuntimeState } from "../State/RuntimeState";
import { Breakpoint, BreakpointPolicy } from "../State/Breakpoint";
import { DebugBridgeListenerInterface } from "./DebugBridgeListenerInterface";
import { DebuggingTimeline } from "../State/DebuggingTimeline";
import { DeviceConfig } from "../DebuggerConfig";

export interface DebugBridge {

  requestMissingState(): Promise<void>;

  refreshViews(): void;

  connect(): Promise<string>;

  getDebuggingTimeline(): DebuggingTimeline;

  getCurrentState(): RuntimeState | undefined;

  updateRuntimeState(runtimeState: RuntimeState, opts?: { refreshViews?: boolean, includeInTimeline?: boolean }): void;

  isUpdateOperationAllowed(): boolean;

  getBreakpointPossibilities(): Breakpoint[];


  proxify(): void;

  step(): Promise<void>;

  stepBack(): void;

  run(): Promise<void>;

  pause(): Promise<void>;

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

  refresh(): Promise<void>;

  notifyNewEvent(): void;

  disconnect(): void;


  upload(): void;

  updateModule(wasm: Buffer): void;

  updateSourceMapper(newSourceMap: SourceMap): void;

  updateLocal(local: VariableInfo): Promise<string>;

  updateGlobal(updateGlobal: VariableInfo): Promise<void>;

  getBreakpointPolicy(): BreakpointPolicy;

  setBreakpointPolicy(policy: BreakpointPolicy): void;

  getDeviceConfig(): DeviceConfig;

  getListener(): DebugBridgeListenerInterface;

  registerCallbacks(): void;
}