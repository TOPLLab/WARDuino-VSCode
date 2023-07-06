import {DebugProtocol} from 'vscode-debugprotocol';
import {basename} from 'path-browserify';
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
import {CompileTimeError} from '../CompilerBridges/CompileTimeError';
import {ErrorReporter} from './ErrorReporter';
import {DebugBridge} from '../DebugBridges/DebugBridge';
import {DebugBridgeFactory} from '../DebugBridges/DebugBridgeFactory';
import {RunTimeTarget} from '../DebugBridges/RunTimeTarget';
import {CompileBridgeFactory} from '../CompilerBridges/CompileBridgeFactory';
import {CompileBridge} from '../CompilerBridges/CompileBridge';
import {SourceMap, getLocationForAddress, Location} from '../State/SourceMap';
import {VariableInfo} from '../State/VariableInfo';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {WOODDebugBridge} from '../DebugBridges/WOODDebugBridge';
import {EventsProvider} from '../Views/EventsProvider';
import {StackProvider} from '../Views/StackProvider';
import {ProxyCallItem, ProxyCallsProvider} from '../Views/ProxyCallsProvider';
import {CompileResult} from '../CompilerBridges/CompileBridge';
import {DeviceConfig} from '../DebuggerConfig';
import {BreakpointPolicyItem, BreakpointPolicyProvider} from '../Views/BreakpointPolicyProvider';
import {Breakpoint, BreakpointPolicy} from '../State/Breakpoint';
import {DebuggingTimelineProvider, TimelineItem} from '../Views/DebuggingTimelineProvider';
import {RuntimeViewsRefresher} from '../Views/ViewsRefresh';
import {DevicesManager} from '../DebugBridges/DevicesManager';
import {EventsMessages} from '../DebugBridges/AbstractDebugBridge';
import {RuntimeState} from '../State/RuntimeState';

const debugmodeMap = new Map<string, RunTimeTarget>([
    ['emulated', RunTimeTarget.emulator],
    ['embedded', RunTimeTarget.embedded]
]);

interface OnStartBreakpoint {
    source: {
        name: string,
        path: string
    },
    linenr: number
}

// Interface between the debugger and the VS runtime
export class WARDuinoDebugSession extends LoggingDebugSession {
    private sourceMap?: SourceMap = undefined;
    private program: string = '';
    private tmpdir: string;
    private THREAD_ID: number = 42;
    private currentLocation: Location = {line: 0, column: 0};
    private debugBridge?: DebugBridge;
    private proxyBridge?: DebugBridge;
    private notifier: vscode.StatusBarItem;
    private reporter: ErrorReporter;
    private proxyCallsProvider?: ProxyCallsProvider;
    private breakpointPolicyProvider?: BreakpointPolicyProvider;
    private timelineProvider?: DebuggingTimelineProvider;
    private stackProvider?: StackProvider;

    private extensionName = 'warduinodebug';
    private viewsRefresher: RuntimeViewsRefresher = new RuntimeViewsRefresher(this.extensionName);

    private variableHandles = new Handles<'locals' | 'globals' | 'arguments'>();
    private compiler?: CompileBridge;

    private devicesManager: DevicesManager = new DevicesManager();

    private startingBPs: OnStartBreakpoint[];

    public constructor(notifier: vscode.StatusBarItem, reporter: ErrorReporter) {
        super('debug_log.txt');
        this.notifier = notifier;
        this.reporter = reporter;
        this.tmpdir = '/tmp/';
        this.startingBPs = [];
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
        response.body.completionTriggerCharacters = ['.', '['];

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
        const deviceConfig = DeviceConfig.fromWorkspaceConfig();
        this.viewsRefresher.showViewsFromConfig(deviceConfig);
        const eventsProvider = new EventsProvider();
        this.viewsRefresher.addViewProvider(eventsProvider);
        vscode.window.registerTreeDataProvider('events', eventsProvider);

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

        this.compiler = CompileBridgeFactory.makeCompileBridge(args.program, this.tmpdir, vscode.workspace.getConfiguration().get('warduino.WABToolChainPath') ?? '');
        if (deviceConfig.onStartConfig.flash) {
            const makefilepath = path.join(vscode.workspace.getConfiguration().get('warduino.WARDuinoToolChainPath')!, '/platforms/Arduino/');
            await this.compiler.clean(makefilepath);
        }

        let compileResult: CompileResult | void = await this.compiler.compile().catch((reason) => this.handleCompileError(reason));
        if (compileResult) {
            this.sourceMap = compileResult.sourceMap;
        }

        const debugmode: string = deviceConfig.debugMode;
        const debugBridge = DebugBridgeFactory.makeDebugBridge(args.program, deviceConfig, this.sourceMap as SourceMap, debugmodeMap.get(debugmode) ?? RunTimeTarget.emulator, this.tmpdir);
        this.registerGUICallbacks(debugBridge);

        try {
            this.devicesManager.addDevice(debugBridge);
            this.setDebugBridge(debugBridge);

            await debugBridge.connect();
            if (deviceConfig.onStartConfig.pause) {
                const rs = await this.debugBridge?.refresh();
                if (rs) {
                    this.debugBridge?.updateRuntimeState(rs);
                }
            }

            if (this.startingBPs.length > 0) {
                const validBps = this.startingBPs.filter(bp => {
                    return bp.source.path === args.program;
                }).map(bp => bp.linenr);
                await debugBridge.setBreakPoints(validBps);
                this.startingBPs = [];
            }
            this.sendResponse(response);
            if (debugBridge.getDeviceConfig().onStartConfig.pause) {
                this.onPause();
            }
        } catch (reason) {
            console.error(reason);
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
            vscode.window.registerTreeDataProvider('proxies', this.proxyCallsProvider);

        } else {
            this.proxyCallsProvider?.setDebugBridge(next);
        }

        if (next.getDeviceConfig().isBreakpointPolicyEnabled()) {
            if (!!!this.breakpointPolicyProvider) {
                this.breakpointPolicyProvider = new BreakpointPolicyProvider(next);
                this.viewsRefresher.addViewProvider(this.breakpointPolicyProvider);
                vscode.window.registerTreeDataProvider('breakpointPolicies', this.breakpointPolicyProvider);
            } else {
                this.breakpointPolicyProvider.setDebugBridge(next);
            }
            this.breakpointPolicyProvider.refresh();
        }

        if (!!!this.timelineProvider) {
            this.timelineProvider = new DebuggingTimelineProvider(next);
            this.viewsRefresher.addViewProvider(this.timelineProvider);
            const v = vscode.window.createTreeView('debuggingTimeline', {treeDataProvider: this.timelineProvider});
            this.timelineProvider.setView(v);
        } else {
            this.timelineProvider.setDebugBridge(next);
        }

        if (this.stackProvider) {
            this.stackProvider.setDebugBridge(next);
        } else {
            this.stackProvider = new StackProvider(next);
            this.viewsRefresher.addViewProvider(this.stackProvider);
            vscode.window.registerTreeDataProvider('stack', this.stackProvider);
        }
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): Promise<void> {
        await this.debugBridge?.run();
        this.sendResponse(response);
    }

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request): Promise<void> {
        await this.debugBridge?.pause();
        this.sendResponse(response);
        this.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
    }

    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
        const v = this.variableHandles.get(args.variablesReference);
        const db = this.debugBridge;
        const state = db?.getCurrentState();
        const isPresent = db?.getDebuggingTimeline().isActiveStatePresent();
        const isUpdateAllowed = db?.isUpdateOperationAllowed();
        let newvariable: VariableInfo | undefined = undefined;
        if (v === 'locals' && db && state) {
            if (isUpdateAllowed) {
                newvariable = state.updateLocal(args.name, args.value);
                if (!!newvariable) {
                    if (!!!isPresent) {
                        await db.pushSession(state.getSendableState());
                        db.getDebuggingTimeline().makeCurrentStateNewPresent();
                        this.timelineProvider?.refreshView();
                    }
                    await db.updateLocal(newvariable);
                } else {
                    newvariable = state?.getLocal(args.name);
                }
            } else {
                newvariable = state?.getLocal(args.name);
            }
        } else if (v === 'globals' && db && state) {
            if (isUpdateAllowed) {
                newvariable = state?.updateGlobal(args.name, args.value);
                if (!!newvariable) {
                    if (!!!isPresent) {
                        await db.pushSession(state.getSendableState());
                        db.getDebuggingTimeline().makeCurrentStateNewPresent();
                        this.timelineProvider?.refreshView();
                    }
                    await this.debugBridge?.updateGlobal(newvariable);
                } else {
                    newvariable = state?.getGlobal(args.name);
                }
            } else {
                newvariable = state?.getGlobal(args.name);
            }
        } else if (v === 'arguments' && db && state) {
            if (isUpdateAllowed) {
                newvariable = state?.updateArgument(args.name, args.value);
                if (!!newvariable) {
                    if (!!!isPresent) {
                        await db.pushSession(state.getSendableState());
                        db.getDebuggingTimeline().makeCurrentStateNewPresent();
                        this.timelineProvider?.refreshView();
                    }
                    await this.debugBridge?.updateArgument(newvariable);
                } else {
                    newvariable = state?.getArgument(args.name);
                }
            } else {
                newvariable = state?.getArgument(args.name);
            }
        }

        if (!!!isUpdateAllowed) {
            this.onDisallowedAction(this.debugBridge!, 'Update value disallowed in viewing mode');
        }

        response.body = {
            value: newvariable!.value,
        };
        this.sendResponse(response);
    }

    // Commands

    public upload() {
        this.debugBridge?.upload();
    }

    public async updateModule(): Promise<void> {
        let res: void | CompileResult = await this.compiler?.compile().catch((reason) => this.handleCompileError(reason));
        if (!!res) {
            if (!!res.wasm) {
                // remove no longer needed breakpoints
                const invalidBpsAfterUpdate = this.debugBridge?.getBreakpoints().filter(bp => bp.id > res!.wasm.length) || [];
                await Promise.all(invalidBpsAfterUpdate.map(bp => this.debugBridge?.unsetBreakPoint(bp)));

                this.sourceMap = res.sourceMap;
                this.notifyProgress('updating module...');
                await this.debugBridge?.updateModule(res.wasm);
                this.debugBridge?.updateSourceMapper(res.sourceMap);
                this.viewsRefresher.refreshViews();
                await this.debugBridge?.refresh();
                this.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
            }
        }
    }

    public async commitChanges(): Promise<void> {
        const proxyBridge = this.devicesManager.getProxyBridge(this.debugBridge!);
        const res = await this.compiler?.compile();

        if (!(res && res.wasm)) {
            return;
        }

        if (proxyBridge?.getDeviceConfig().usesWiFi()) {
            proxyBridge?.disconnectMonitor();
        } else {
            this.debugBridge?.disconnect();
            const flash = false;
            await proxyBridge?.connect(flash);
        }

        // remove no longer needed breakpoints
        const invalidBpsAfterUpdate = proxyBridge!.getBreakpoints().filter(bp => bp.id > res!.wasm.length) || [];
        await Promise.all(invalidBpsAfterUpdate.map(bp => proxyBridge!.unsetBreakPoint(bp)));

        await proxyBridge!.updateModule(res.wasm);
        this.viewsRefresher.refreshViews();
        proxyBridge!.updateSourceMapper(res.sourceMap);
        this.sourceMap = res.sourceMap;

        this.setDebugBridge(proxyBridge!);

        if (proxyBridge!.getDeviceConfig().isBreakpointPolicyEnabled() && proxyBridge!.getDeviceConfig().getBreakpointPolicy() !== BreakpointPolicy.default) {
            this.onRunning();
        } else {
            await proxyBridge?.refresh();
            this.onPause();
        }
    }

    public async startMultiverseDebugging() {
        const index = this.debugBridge?.getDebuggingTimeline().getIndexOfActiveState();
        const item = this.timelineProvider?.getItemFromTimeLineIndex(index ?? -1);
        if (!!item) {
            await this.saveRuntimeState(item);
            const bridge = this.debugBridge;
            const state = this.debugBridge?.getCurrentState();
            this.startDebuggingOnEmulatorHelper(bridge!, state!);
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
        this.debugBridge?.getDeviceConfig().setBreakpointPolicy(activePolicy?.getPolicy() ?? BreakpointPolicy.default);
        this.breakpointPolicyProvider!.refresh();
    }

    public showViewOnRuntimeState(item: TimelineItem) {
        const index = item.getTimelineIndex();
        if (!this.debugBridge?.getDebuggingTimeline().activateStateFromIndex(index)) {
            this.debugBridge?.getDebuggingTimeline().advanceToPresent();
        }
        const state = this.debugBridge?.getCurrentState();
        if (!!state) {
            const doNotSave = {includeInTimeline: false};
            this.debugBridge?.updateRuntimeState(state, doNotSave);
            this.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
        }
    }


    public async saveRuntimeState(item: TimelineItem) {
        const itemIdx = item.getTimelineIndex();
        const timeline = this.debugBridge?.getDebuggingTimeline();
        const numberStates = timeline?.size();
        const savingPresentState = (itemIdx + 1) === numberStates;

        // only save the present state
        if (savingPresentState && !!timeline?.isActiveStatePresent()) {
            this.notifyInfoMessage(this.debugBridge!, 'Retrieving and saving state');
            this.timelineProvider?.showItemAsBeingSaved(item);
            this.timelineProvider?.refreshView();
            await this.debugBridge?.requestMissingState();
            this.debugBridge?.emitNewStateEvent();
        }
    }

    public async startDebuggingOnEmulator(item: TimelineItem) {
        const itemIdx = item.getTimelineIndex();
        const state = this.debugBridge?.getDebuggingTimeline().getStateFromIndex(itemIdx);
        if (!!!state || !state.hasAllState()) {
            return;
        }
        const bridge = item.getDebuggerBridge();
        const stateToUse = item.getRuntimeState();
        await this.startDebuggingOnEmulatorHelper(bridge, stateToUse);
    }

    //

    private async startDebuggingOnEmulatorHelper(bridge: DebugBridge, stateToUse: RuntimeState) {

        const config = bridge.getDeviceConfig();
        const name = `${config.name} (Proxied Emulator)`;
        const dc = DeviceConfig.configForProxy(name, config);
        const state = stateToUse.deepcopy();

        const newBridge = DebugBridgeFactory.makeDebugBridge(this.program, dc, this.sourceMap as SourceMap, RunTimeTarget.wood, this.tmpdir);
        this.registerGUICallbacks(newBridge);
        await bridge.proxify();

        if (!config.usesWiFi()) {
            bridge.disconnect();
        }
        console.log('Plugin: transfer state received.');

        try {
            await newBridge.connect();
            this.devicesManager.addDevice(newBridge, bridge);
            this.setDebugBridge(newBridge);
            await newBridge.pushSession(state.getSendableState());
            await (newBridge as WOODDebugBridge).specifyProxyCalls();
            newBridge.updateRuntimeState(state);
            this.onPause();
        } catch (reason) {
            console.error(reason);
        }
    }

    public async swithDebuggingTarget() {
        if (!!!this.debugBridge) {
            return;
        }
        let br = undefined;
        if (this.debugBridge.getDeviceConfig().isForHardware()) {
            br = this.devicesManager.getEmulatorBridge(this.debugBridge);
        } else {
            br = this.devicesManager.getProxyBridge(this.debugBridge);
        }
        if (!!br) {
            this.setDebugBridge(br);
            const state = br.getDebuggingTimeline().getActiveState();
            this.viewsRefresher.refreshViews(state);
            this.onConnected(br);
            this.onPause();
        }
    }

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

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request): Promise<void> {
        let responseBps: Breakpoint[] = [];
        if (!!this.debugBridge) {
            responseBps = await this.debugBridge.setBreakPoints(args.lines ?? []);
        } else if (!!args.lines && !!args.source) {
            // case where the bridge did not start yet.
            // Store bps so to set them after connection to bridge
            const toConcat = args.lines.map((linenr: number) => {
                return {
                    'source': {
                        name: args.source.name!,
                        path: args.source.path!
                    },
                    'linenr': linenr
                };
            });
            this.startingBPs = this.startingBPs.concat(toConcat);
        }
        response.body = {
            breakpoints: responseBps
        };
        this.sendResponse(response);
    }

    protected setInstructionBreakpointsRequest(response: DebugProtocol.SetInstructionBreakpointsResponse, args: DebugProtocol.SetInstructionBreakpointsArguments) {
        console.log('setInstructionBreakpointsRequest');
        response.body = {
            breakpoints: []
        };
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [new Thread(this.THREAD_ID, 'WARDuino Debug Thread')]
        };
        this.sendResponse(response);
    }

    private setLineNumberFromPC(pc: number) {
        this.currentLocation = getLocationForAddress(this.sourceMap!, pc) ?? this.currentLocation;
    }


    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        response.body = {
            scopes: [
                new Scope('Locals', this.variableHandles.create('locals'), false),
                new Scope('Globals', this.variableHandles.create('globals'), true),
                new Scope('Arguments', this.variableHandles.create('arguments'), true),
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
        if (v === 'locals') {
            const locals = this.debugBridge?.getCurrentState()?.getLocals() ?? [];
            response.body = {
                variables: Array.from(locals, (local) => {
                    return {
                        name: (local.name === ''
                            ? local.index.toString()
                            : local.name),
                        value: local.value.toString(), variablesReference: 0
                    };
                })
            };
            this.sendResponse(response);
        } else if (v === 'globals') {
            const globals = this.debugBridge?.getCurrentState()?.getGlobals() ?? this.sourceMap.globalInfos;
            response.body = {
                variables: Array.from(globals, (info) => {
                    return {name: info.name, value: info.value, variablesReference: 0};
                })
            };
            this.sendResponse(response);
        } else if (v === 'arguments') {
            const state = this.debugBridge?.getCurrentState()?.getArguments() ?? [];
            response.body = {
                variables: Array.from(state, (info) => {
                    return {name: info.name, value: info.value, variablesReference: 0};
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
            'module',
            this.createSource(this.program),
            1);

        const callstack = this.debugBridge?.getCurrentState()?.getCallStack() ?? [];
        let frames = Array.from(callstack.reverse(), (frame, index) => {
            // @ts-ignore
            const functionInfo = this.sourceMap.functionInfos[frame.index];
            let start = (index === 0) ? this.currentLocation.line : getLocationForAddress(this.sourceMap!, callstack[index - 1].returnAddress)?.line ?? 0;
            let location: Location | undefined = (index === 0) ? {line: this.currentLocation.line, column: 0} : getLocationForAddress(this.sourceMap!, callstack[index - 1].returnAddress) ?? {line: 0, column: 0};
            let name = (functionInfo === undefined) ? '<anonymous>' : functionInfo.name;

            return new StackFrame(index, name,
                this.createSource(this.program), // TODO
                this.convertDebuggerLineToClient(location.line),
                this.convertDebuggerColumnToClient(location.column)); // TODO
        });
        frames.push(bottom);
        frames[0].line = this.convertDebuggerLineToClient(this.currentLocation.line);
        frames[0].column = this.convertDebuggerColumnToClient(this.currentLocation.column);

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

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        console.log('nextRequest');
        this.sendResponse(response);
        this.debugBridge?.step();
    }

    protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments, request?: DebugProtocol.Request): void {
        console.log('backRequest');
        this.sendResponse(response);
        this.debugBridge?.stepBack();
    }

    override shutdown(): void {
        console.log('Shutting the debugger down');
        this.debugBridge?.disconnect();
        if (this.tmpdir) {
            fs.rm(this.tmpdir, {recursive: true}, err => {
                if (err) {
                    throw new Error('Could not delete temporary directory.');
                }
            });
        }
    }

    public notifyStepCompleted() {
        this.sendEvent(new StoppedEvent('step', this.THREAD_ID));
    }

    private registerGUICallbacks(debugBridge: DebugBridge) {
        debugBridge.on(EventsMessages.stateUpdated, (newState: RuntimeState) => {
            this.onNewState(newState);
        });
        debugBridge.on(EventsMessages.moduleUpdated, (db: DebugBridge) => {
            this.notifyInfoMessage(db, EventsMessages.moduleUpdated);
        });
        debugBridge.on(EventsMessages.stepCompleted, () => {
            this.onStepCompleted();
        });
        debugBridge.on(EventsMessages.running, () => {
            this.onRunning();
        });
        debugBridge.on(EventsMessages.paused, () => {
            this.onPause();
        });
        debugBridge.on(EventsMessages.exceptionOccurred, (db: DebugBridge, state: RuntimeState) => {
            this.onException(db, state);
        });
        debugBridge.on(EventsMessages.enforcingBreakpointPolicy, (db: DebugBridge, policy: BreakpointPolicy) => {
            this.onEnforcingBPPolicy(db, policy);
        });
        debugBridge.on(EventsMessages.atBreakpoint, (db: DebugBridge, line: any) => {
            if (db.getDeviceConfig().isBreakpointPolicyEnabled()) {
                if (db.getDeviceConfig().getBreakpointPolicy() !== BreakpointPolicy.default) {
                    let msg = 'reached breakpoint';
                    if (line !== undefined) {
                        msg += ` at line ${line}`;
                    }
                    this.notifyInfoMessage(db, msg);
                }
            }
        });
        debugBridge.on(EventsMessages.emulatorStarted, (db: DebugBridge) => {
            const name = db.getDeviceConfig().name;
            const msg = `Emulator for ${name} spawned`;
            this.notifyProgress(msg);
        });
        debugBridge.on(EventsMessages.emulatorClosed, (db: DebugBridge, reason: number | null) => {
            const name = db.getDeviceConfig().name;
            let msg = `Emulator for ${name} closed`;
            if (reason !== null) {
                msg += ` reason: ${reason}`;
            }
            this.notifyProgress(msg);
        });
        debugBridge.on(EventsMessages.connected, (db: DebugBridge) => {
            this.onConnected(db);
        });
        debugBridge.on(EventsMessages.disconnected, (db: DebugBridge) => {
            const name = db.getDeviceConfig().name;
            const msg = `Disconected from ${name}`;
            this.notifyProgress(msg);
            this.notifyInfoMessage(db, 'Disconnected');
        });
        debugBridge.on(EventsMessages.connectionError, (db: DebugBridge, err: number | null) => {
            const name = db.getDeviceConfig().name;
            let msg = `Connection to ${name} failed`;
            if (err !== null) {
                msg += ` reason: ${err}`;
            }
            this.notifyProgress(msg);
        });
        debugBridge.on(EventsMessages.progress, (db: DebugBridge, msg: string) => {
            this.notifyInfoMessage(db, msg);
        });
        debugBridge.on(EventsMessages.errorInProgress, (db: DebugBridge, msg: string) => {
            this.notifyErrorMessage(db, msg);
        });
    }

    private onConnected(db: DebugBridge) {
        const name = db.getDeviceConfig().name;
        const msg = `Connected to ${name}`;
        this.notifyProgress(msg);
        this.notifyInfoMessage(db, 'Connected');
    }

    private onNewState(runtimeState: RuntimeState) {
        this.viewsRefresher.refreshViews(runtimeState);
    }

    private onStepCompleted() {
        this.sendEvent(new StoppedEvent('step', this.THREAD_ID));
    }

    private onRunning() {
        this.sendEvent(new ContinuedEvent(this.THREAD_ID));
    }

    private onPause() {
        this.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
    }

    private onException(debugBridge: DebugBridge, runtime: RuntimeState) {
        const name = debugBridge.getDeviceConfig().name;
        const exception = runtime.getExceptionMsg();
        const includeMinusOne = false;
        const loc = getLocationForAddress(runtime.getSourceMap(), runtime.getExceptionLocation(), includeMinusOne)?.line ?? -1;
        const msg = `${name}: exception occurred at (Line ${loc}). ${exception}`;
        vscode.window.showErrorMessage(msg);
    }

    private onEnforcingBPPolicy(db: DebugBridge, policy: BreakpointPolicy) {
        const msg = `Enforcing '${policy}' breakpoint policy`;
        this.notifyInfoMessage(db, msg);
    }

    private notifyProgress(msg: string) {
        this.notifier.text = msg;
    }

    private onDisallowedAction(db: DebugBridge, msg: string) {
        const name = db.getDeviceConfig().name;
        const m = `${name}: ${msg}`;
        vscode.window.showErrorMessage(m);
    }

    private notifyInfoMessage(db: DebugBridge, msg: string) {
        const name = db.getDeviceConfig().name;
        const m = `${name}: ${msg}`;
        vscode.window.showInformationMessage(m);
    }

    private notifyErrorMessage(db: DebugBridge, msg: string) {
        const name = db.getDeviceConfig().name;
        const m = `${name}: ${msg}`;
        vscode.window.showErrorMessage(m);
    }
}
