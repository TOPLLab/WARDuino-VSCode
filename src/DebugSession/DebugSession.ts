import { DebugProtocol } from 'vscode-debugprotocol';
import { basename } from 'path-browserify';
import * as vscode from 'vscode';

import {
    ContinuedEvent,
    Handles,
    InitializedEvent,
    LoggingDebugSession,
    Scope,
    Source,
    StackFrame,
    StoppedEvent,
    TerminatedEvent,
    Thread
} from 'vscode-debugadapter';
import { CompileTimeError } from "../CompilerBridges/CompileTimeError";
import { ErrorReporter } from "./ErrorReporter";
import { DebugBridge } from '../DebugBridges/DebugBridge';
import { DebugBridgeFactory } from '../DebugBridges/DebugBridgeFactory';
import { RunTimeTarget } from "../DebugBridges/RunTimeTarget";
import { CompileBridgeFactory } from "../CompilerBridges/CompileBridgeFactory";
import { CompileBridge } from "../CompilerBridges/CompileBridge";
import { SourceMap } from "../State/SourceMap";
import { VariableInfo } from "../State/VariableInfo";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WOODState } from "../State/WOODState";
import { WOODDebugBridge } from "../DebugBridges/WOODDebugBridge";
import { EventsProvider } from "../Views/EventsProvider";
import { StackProvider } from "../Views/StackProvider";
import { ProxyCallItem, ProxyCallsProvider } from "../Views/ProxyCallsProvider";
import { CompileResult } from '../CompilerBridges/CompileBridge';
import { DebuggerConfig, DeviceConfig } from '../DebuggerConfig';
import { ArduinoTemplateBuilder } from '../arduinoTemplates/templates/TemplateBuilder';
import { BreakpointPolicyItem, BreakpointPolicyProvider } from '../Views/BreakpointPolicyProvider';
import { BreakpointPolicy } from '../State/Breakpoint';
import { DebuggingTimelineProvider, TimelineItem } from '../Views/DebuggingTimelineProvider';
import { RuntimeViewsRefresher } from '../Views/ViewsRefresh';
import { DevicesManager } from '../DebugBridges/DevicesManager';
import { BridgeListener } from '../DebugBridges/DebugBridgeListener';
import { Messages } from '../DebugBridges/AbstractDebugBridge';
import { DebugBridgeListenerInterface } from '../DebugBridges/DebugBridgeListenerInterface';

const debugmodeMap = new Map<string, RunTimeTarget>([
    ["emulated", RunTimeTarget.emulator],
    ["embedded", RunTimeTarget.embedded]
]);

// Interface between the debugger and the VS runtime 
export class WARDuinoDebugSession extends LoggingDebugSession {
    private sourceMap?: SourceMap = undefined;
    private program: string = "";
    private tmpdir: string;
    private THREAD_ID: number = 42;
    private testCurrentLine = 0;
    private debugBridge?: DebugBridge;
    private notifier: vscode.StatusBarItem;
    private reporter: ErrorReporter;
    private proxyCallsProvider?: ProxyCallsProvider;
    private breakpointPolicyProvider?: BreakpointPolicyProvider;
    private timelineProvider?: DebuggingTimelineProvider;

    private viewsRefresher: RuntimeViewsRefresher = new RuntimeViewsRefresher();

    private variableHandles = new Handles<'locals' | 'globals' | 'arguments'>();
    private compiler?: CompileBridge;

    private debuggerConfig: DebuggerConfig = new DebuggerConfig();

    private devicesManager: DevicesManager = new DevicesManager();

    public constructor(notifier: vscode.StatusBarItem, reporter: ErrorReporter) {
        super("debug_log.txt");
        this.notifier = notifier;
        this.reporter = reporter;
        this.tmpdir = "/tmp/";
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        // build and return the capabilities of this debug adapter:
        response.body = response.body || {};

        // the adapter implements the configurationDone request.
        response.body.supportsConfigurationDoneRequest = true;

        // make VS Code use 'evaluate' when hovering over source
        response.body.supportsEvaluateForHovers = false;

        // make VS Code show a 'step back' button
        response.body.supportsStepBack = true;

        // make VS Code support data breakpoints
        response.body.supportsDataBreakpoints = false;

        // make VS Code support completion in REPL
        response.body.supportsCompletionsRequest = false;
        response.body.completionTriggerCharacters = [".", "["];

        // make VS Code send cancel request
        response.body.supportsCancelRequest = false;

        // make VS Code send the breakpointLocations request
        response.body.supportsBreakpointLocationsRequest = true;

        // make VS Code provide "Step in Target" functionality
        response.body.supportsStepInTargetsRequest = false;

        // the adapter defines two exceptions filters, one with support for conditions.
        response.body.supportsExceptionFilterOptions = false;

        // make VS Code send exceptionInfo request
        response.body.supportsExceptionInfoRequest = false;

        // make VS Code send setVariable request
        response.body.supportsSetVariable = true;

        // make VS Code send setExpression request
        response.body.supportsSetExpression = false;

        // make VS Code send disassemble request
        response.body.supportsDisassembleRequest = false;
        response.body.supportsSteppingGranularity = false;
        response.body.supportsInstructionBreakpoints = false;

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: any) {
        console.log(args.program);
        this.reporter.clear();
        this.program = args.program;

        this.debuggerConfig.fillConfig(args);

        const eventsProvider = new EventsProvider();
        this.viewsRefresher.addViewProvider(eventsProvider);
        vscode.window.registerTreeDataProvider("events", eventsProvider);
        const stackProvider = new StackProvider();
        this.viewsRefresher.addViewProvider(stackProvider);
        vscode.window.registerTreeDataProvider("stack", stackProvider);

        await new Promise((resolve, reject) => {
            fs.mkdtemp(path.join(os.tmpdir(), 'warduino.'), (err, tmpdir) => {
                if (err === null) {
                    this.tmpdir = tmpdir;
                    resolve(null);
                } else {
                    reject();
                }
            });
        });

        if (this.debuggerConfig.device.isForHardware()) {
            const dc = this.debuggerConfig.device;
            const path2sdk = vscode.workspace.getConfiguration().get("warduino.WARDuinoToolChainPath") as string;
            ArduinoTemplateBuilder.setPath2Templates(path2sdk);
            ArduinoTemplateBuilder.build(dc);
        }

        this.compiler = CompileBridgeFactory.makeCompileBridge(args.program, this.tmpdir, vscode.workspace.getConfiguration().get("warduino.WABToolChainPath") ?? "");

        let compileResult: CompileResult | void = await this.compiler.compile().catch((reason) => this.handleCompileError(reason));
        if (compileResult) {
            this.sourceMap = compileResult.sourceMap;
        }

        const debugmode: string = this.debuggerConfig.device.debugMode;
        const deviceConfig = this.debuggerConfig.device;

        const listener: DebugBridgeListenerInterface = new BridgeListener(this, this.THREAD_ID, this.notifier);
        const debugBridge = DebugBridgeFactory.makeDebugBridge(args.program, this.debuggerConfig.device, this.sourceMap as SourceMap, this.viewsRefresher, debugmodeMap.get(debugmode) ?? RunTimeTarget.emulator, this.tmpdir, listener);

        try {
            await debugBridge.connect();
            listener.connected();
            this.devicesManager.addDevice(debugBridge);
            this.setDebugBridge(debugBridge);
            this.sendResponse(response);
            this.sendEvent(new StoppedEvent('entry', this.THREAD_ID));
        }
        catch (reason) {
            console.error(reason);
            listener.notifyError(Messages.connectionFailure);
        }
    }

    private setDebugBridge(next: DebugBridge) {
        if (this.debugBridge !== undefined) {
            next.setSelectedProxies(this.debugBridge.getSelectedProxies());
        }
        this.debugBridge = next;
        if (this.proxyCallsProvider === undefined) {
            this.proxyCallsProvider = new ProxyCallsProvider(next);
            this.viewsRefresher.addViewProvider(this.proxyCallsProvider);
            vscode.window.registerTreeDataProvider("proxies", this.proxyCallsProvider);

        } else {
            this.proxyCallsProvider?.setDebugBridge(next);
        }

        if (!!!this.breakpointPolicyProvider) {
            this.breakpointPolicyProvider = new BreakpointPolicyProvider(next);
            this.viewsRefresher.addViewProvider(this.breakpointPolicyProvider);
            vscode.window.registerTreeDataProvider("breakpointPolicies", this.breakpointPolicyProvider);
        } else {
            this.breakpointPolicyProvider.setDebugBridge(next);
        }
        this.breakpointPolicyProvider.refresh();

        if (!!!this.timelineProvider) {
            this.timelineProvider = new DebuggingTimelineProvider(next);
            this.viewsRefresher.addViewProvider(this.timelineProvider);
            const v = vscode.window.createTreeView("debuggingTimeline", { treeDataProvider: this.timelineProvider });
            this.timelineProvider.setView(v);
        } else {
            this.timelineProvider.setDebugBridge(next);
        }
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.debugBridge?.run();
        this.sendResponse(response);
    }

    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request): void {
        this.debugBridge?.pause();
        this.sendResponse(response);
        this.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
    }

    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
        const v = this.variableHandles.get(args.variablesReference);
        const state = this.debugBridge?.getCurrentState();
        let newvariable: VariableInfo | undefined = undefined;
        if (v === "locals") {
            newvariable = state?.updateLocal(args.name, args.value);
            if (!!newvariable) {
                await this.debugBridge?.updateLocal(newvariable);
            }
            else {
                newvariable = state?.getLocal(args.name);
            }
        }
        else if (v === "globals") {
            newvariable = state?.updateGlobal(args.name, args.value);
            if (!!newvariable) {
                await this.debugBridge?.updateGlobal(newvariable);
            }
            else {
                newvariable = state?.getGlobal(args.name);
            }
        }
        else if (v === "arguments") {
            newvariable = state?.updateArgument(args.name, args.value);
            if (!!newvariable) {
                await this.debugBridge?.updateLocal(newvariable);
            } else {
                newvariable = state?.getArgument(args.name);
            }
        }


        let newvalue = "invalid";
        if (!!newvariable) {
            newvalue = newvariable?.value;
        }
        response.body = {
            value: newvalue,
        };
        this.sendResponse(response);
    }

    // Commands

    public upload() {
        this.debugBridge?.upload();
    }

    public updateModule() {
        this.uploadHelper().then(r => { console.log(r); }).catch(e => {
            console.error(`upload went wrong ${e}`);
        });
    }

    private async uploadHelper(): Promise<string> {
        let res: void | CompileResult = await this.compiler?.compile().catch((reason) => this.handleCompileError(reason));
        if (!!res) {
            this.sourceMap = res.sourceMap;
            this.debugBridge?.updateSourceMapper(res.sourceMap);
            if (!!res.wasm) {
                this.debugBridge?.updateModule(res.wasm);
                return "sent upload module";
            }
        }
        return "failed to upload module";
    }

    public startMultiverseDebugging() {
        const index = this.debugBridge?.getDebuggingTimeline().getIndexOfActiveState();
        const item = this.timelineProvider?.getItemFromTimeLineIndex(index ?? - 1);
        if (!!item) {
            this.saveRuntimeState(item);
            console.info("(TODO) startMultiveDebugging: for now just pulls state but does not spawn yet a local VM");
        }
    }

    public popEvent() {
        this.debugBridge?.popEvent();
    }

    public toggleProxy(resource: ProxyCallItem) {
        resource.toggle();
        this.debugBridge?.updateSelectedProxies(resource);
        this.proxyCallsProvider?.refresh();
    }

    public toggleBreakpointPolicy(item: BreakpointPolicyItem) {
        this.breakpointPolicyProvider!.toggleItem(item);
        const activePolicy = this.breakpointPolicyProvider!.getSelected();
        this.debugBridge?.setBreakpointPolicy(activePolicy?.getPolicy() ?? BreakpointPolicy.default);
        this.breakpointPolicyProvider!.refresh();
    }

    public showViewOnRuntimeState(item: TimelineItem) {
        const index = item.getTimelineIndex();
        if (!this.debugBridge?.getDebuggingTimeline().activateStateFromIndex(index)) {
            this.debugBridge?.getDebuggingTimeline().advanceToPresent();
        }
        const state = this.debugBridge?.getCurrentState();
        if (!!state) {
            this.viewsRefresher.refreshViews(state);
            this.notifyStepCompleted();
        }
    }


    public saveRuntimeState(item: TimelineItem) {
        const itemIdx = item.getTimelineIndex();
        const timeline = this.debugBridge?.getDebuggingTimeline();
        const numberStates = timeline?.size();
        const savingPresentState = (itemIdx + 1) === numberStates;

        // only save the present state
        if (savingPresentState && !!timeline?.isActiveStatePresent()) {
            this.debugBridge?.getListener().notifyInfoMessage(`Retrieving and saving state from ${this.debugBridge!.getDeviceConfig().name}`);
            this.timelineProvider?.showItemAsBeingSaved(item);
            this.timelineProvider?.refreshView();
            this.debugBridge?.requestMissingState();
        }
    }

    public async startDebuggingOnEmulator(item: TimelineItem) {
        const itemIdx = item.getTimelineIndex();
        const state = this.debugBridge?.getDebuggingTimeline().getStateFromIndex(itemIdx);
        if (!!!state || !state.hasAllState()) {
            return;
        }
        const bridge = item.getDebuggerBridge();
        const config = bridge.getDeviceConfig();
        const name = `${config.name} (Emulator)`;
        const dc = DeviceConfig.configForProxy(name, config);
        const stateToPush = item.getRuntimeState().deepcopy();
        const listener = new BridgeListener(this, this.THREAD_ID, this.notifier);
        const newBridge = DebugBridgeFactory.makeDebugBridge(this.program, dc, this.sourceMap as SourceMap, this.viewsRefresher, RunTimeTarget.wood, this.tmpdir, listener);

        bridge.proxify();
        bridge.disconnect();
        console.log("Plugin: transfer state received.");

        try {
            await newBridge.connect();
            listener.notifyConnected();
            this.devicesManager.addDevice(newBridge);
            this.setDebugBridge(newBridge);
            newBridge.pushSession(stateToPush.getSendableState());
            (newBridge as WOODDebugBridge).specifyProxyCalls();
            newBridge.updateRuntimeState(stateToPush);
        }
        catch (reason) {
            console.error(reason);
            listener.notifyError(Messages.connectionFailure);
        }
    }

    //

    private handleCompileError(handleCompileError: CompileTimeError) {
        let range = new vscode.Range(handleCompileError.lineInfo.line - 1,
            handleCompileError.lineInfo.column,
            handleCompileError.lineInfo.line - 1,
            handleCompileError.lineInfo.column);
        this.reporter.report(range, this.program, handleCompileError.message);
        this.sendEvent(new TerminatedEvent());
    }

    protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
        response.body = {
            breakpoints: this.debugBridge?.getBreakpointPossibilities() ?? []
        };
        this.sendResponse(response);
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request): void {
        response.body = {
            breakpoints: this.debugBridge?.setBreakPoints(args.lines ?? []) ?? []
        };
        this.sendResponse(response);
    }

    protected setInstructionBreakpointsRequest(response: DebugProtocol.SetInstructionBreakpointsResponse, args: DebugProtocol.SetInstructionBreakpointsArguments) {
        console.log("setInstructionBreakpointsRequest");
        response.body = {
            breakpoints: []
        };
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [new Thread(this.THREAD_ID, "WARDuino Debug Thread")]
        };
        this.sendResponse(response);
    }

    private setLineNumberFromPC(pc: number) {
        this.testCurrentLine = this.getLineNumberForAddress(pc);
    }

    private getLineNumberForAddress(address: number): number {
        let line = 0;
        this.sourceMap?.lineInfoPairs.forEach((info) => {
            const candidate = parseInt("0x" + info.lineAddress);
            if (Math.abs(address - candidate) === 0) {
                line = info.lineInfo.line - 1;
            }
        });
        return line;
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        response.body = {
            scopes: [
                new Scope("Locals", this.variableHandles.create('locals'), false),
                new Scope("Globals", this.variableHandles.create('globals'), true),
                new Scope("Arguments", this.variableHandles.create('arguments'), true),
            ]
        };
        this.sendResponse(response);
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments,
        request?: DebugProtocol.Request) {
        if (this.sourceMap === undefined) {
            return;
        }

        const v = this.variableHandles.get(args.variablesReference);
        if (v === "locals") {
            const locals = this.debugBridge?.getCurrentState()?.getLocals() ?? [];
            response.body = {
                variables: Array.from(locals, (local) => {
                    return {
                        name: (local.name === ""
                            ? local.index.toString()
                            : local.name),
                        value: local.value.toString(), variablesReference: 0
                    };
                })
            };
            this.sendResponse(response);
        } else if (v === "globals") {
            const globals = this.debugBridge?.getCurrentState()?.getGlobals() ?? this.sourceMap.globalInfos;
            response.body = {
                variables: Array.from(globals, (info) => {
                    return { name: info.name, value: info.value, variablesReference: 0 };
                })
            };
            this.sendResponse(response);
        } else if (v === "arguments") {
            const state = this.debugBridge?.getCurrentState()?.getArguments() ?? [];
            response.body = {
                variables: Array.from(state, (info) => {
                    return { name: info.name, value: info.value, variablesReference: 0 };
                })
            };
            this.sendResponse(response);
        }
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments): void {
        const pc = this.debugBridge!.getCurrentState()?.getProgramCounter() ?? 0;
        this.setLineNumberFromPC(pc);

        const bottom: DebugProtocol.StackFrame = new StackFrame(0,
            "module",
            this.createSource(this.program),
            1);

        const callstack = this.debugBridge?.getCurrentState()?.getCallStack() ?? [];
        let frames = Array.from(callstack.reverse(), (frame, index) => {
            // @ts-ignore
            const functionInfo = this.sourceMap.functionInfos[frame.index];
            let start = (index === 0) ? this.testCurrentLine : this.getLineNumberForAddress(callstack[index - 1].returnAddress);
            let name = (functionInfo === undefined) ? "<anonymous>" : functionInfo.name;

            return new StackFrame(index, name,
                this.createSource(this.program), // TODO
                this.convertDebuggerLineToClient(start)); // TODO
        });
        frames.push(bottom);
        frames[0].line = this.convertDebuggerLineToClient(this.testCurrentLine);

        if (this.sourceMap !== undefined) {
            response.body = {
                stackFrames: frames,
                totalFrames: frames.length
            };
        }

        this.sendResponse(response);
    }

    private createSource(filePath: string): Source {
        return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mock-adapter-data');
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        console.log("nextRequest");
        this.sendResponse(response);
        this.debugBridge?.step();
    }

    protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments, request?: DebugProtocol.Request): void {
        console.log("backRequest");
        this.sendResponse(response);
        this.debugBridge?.stepBack();
    }

    override shutdown(): void {
        console.log("Shutting the debugger down");
        this.debugBridge?.disconnect();
        if (this.tmpdir) {
            fs.rm(this.tmpdir, { recursive: true }, err => {
                if (err) {
                    throw new Error('Could not delete temporary directory.');
                }
            });
        }
    }

    public notifyStepCompleted() {
        this.sendEvent(new StoppedEvent('step', this.THREAD_ID));
    }

}
