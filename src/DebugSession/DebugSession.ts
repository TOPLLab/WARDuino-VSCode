import {DebugProtocol} from 'vscode-debugprotocol';
import {basename} from 'path-browserify';
import * as vscode from 'vscode';

import {
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
import {CompileTimeError} from "../CompilerBridges/CompileTimeError";
import {ErrorReporter} from "./ErrorReporter";
import {DebugBridge} from '../DebugBridges/DebugBridge';
import {DebugBridgeFactory} from '../DebugBridges/DebugBridgeFactory';
import {RunTimeTarget} from "../DebugBridges/RunTimeTarget";
import {CompileBridgeFactory} from "../CompilerBridges/CompileBridgeFactory";
import {SourceMap} from "../State/SourceMap";
import {VariableInfo} from "../State/VariableInfo";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {WOODState} from "../State/WOODState";
import {WOODDebugBridge} from "../DebugBridges/WOODDebugBridge";
import {ProxyDebugBridge} from "../DebugBridges/ProxyDebugBridge";
import {EventsProvider} from "../Views/EventsProvider";
import {ProxyCallItem, ProxyCallsProvider} from "../Views/ProxyCallsProvider";

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
    private proxyBridge?: DebugBridge;
    private notifier: vscode.StatusBarItem;
    private reporter: ErrorReporter;
    private proxyCallsProvider?: ProxyCallsProvider;

    private variableHandles = new Handles<'locals' | 'globals'>();

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

        const eventsProvider = new EventsProvider();
        vscode.window.registerTreeDataProvider("events", eventsProvider);

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

        let compiler = CompileBridgeFactory.makeCompileBridge(args.program, this.tmpdir, vscode.workspace.getConfiguration().get("warduino.WABToolChainPath") ?? "");

        let sourceMap: SourceMap | void = await compiler.compile().catch((reason) => this.handleCompileError(reason));
        if (sourceMap) {
            this.sourceMap = sourceMap;
        }
        let that = this;
        const debugmode: string = vscode.workspace.getConfiguration().get("warduino.DebugMode") ?? "emulated";
        this.setDebugBridge(DebugBridgeFactory.makeDebugBridge(args.program, sourceMap, eventsProvider,
            debugmodeMap.get(debugmode) ?? RunTimeTarget.emulator,
            this.tmpdir,
            {   // VS Code Interface
                notifyError(): void {

                },
                connected(): void {
                    that.debugBridge?.pause();
                },
                startMultiverseDebugging(woodState: WOODState) {
                    that.debugBridge?.disconnect();

                    that.setDebugBridge(DebugBridgeFactory.makeDebugBridge(args.program, sourceMap, eventsProvider, RunTimeTarget.wood, that.tmpdir, {
                        notifyError(): void {
                        },
                        connected(): void {
                            that.debugBridge?.pushSession(woodState);
                        },
                        startMultiverseDebugging(woodState: WOODState) {
                        },
                        notifyPaused(): void {
                            that.sendEvent(new StoppedEvent('pause', that.THREAD_ID));
                            that.debugBridge?.refresh();
                        },
                        notifyBreakpointHit(): void {
                            that.sendEvent(new StoppedEvent('breakpoint', that.THREAD_ID));
                            that.debugBridge?.refresh();
                        },
                        disconnected(): void {

                        },
                        notifyProgress(message: string): void {
                            that.notifier.text = message;
                        },
                        notifyStateUpdate(): void {
                            that.notifyStepCompleted();
                        }
                    }));

                    that.proxyBridge = DebugBridgeFactory.makeDebugBridge(args.program, sourceMap, eventsProvider, RunTimeTarget.proxy, that.tmpdir, {
                        connected(): void {
                            const socket = (that.proxyBridge as ProxyDebugBridge).getSocket();
                            (that.debugBridge as WOODDebugBridge).specifySocket(socket.host, socket.port);
                        }, disconnected(): void {
                        }, notifyError(message: string): void {
                        }, notifyPaused(): void {
                        }, notifyBreakpointHit() {
                        }, notifyProgress(message: string): void {
                        }, notifyStateUpdate(): void {
                        }, startMultiverseDebugging(woodState: WOODState): void {
                        }
                    });
                },
                notifyPaused(): void {
                    that.sendEvent(new StoppedEvent('pause', that.THREAD_ID));
                    that.debugBridge?.refresh();
                },
                notifyBreakpointHit(): void {
                    that.sendEvent(new StoppedEvent('breakpoint', that.THREAD_ID));
                    that.debugBridge?.refresh();
                },
                disconnected(): void {

                },
                notifyProgress(message: string): void {
                    that.notifier.text = message;
                },
                notifyStateUpdate(): void {
                    that.notifyStepCompleted();
                }
            }
        ));

        this.sendResponse(response);
        this.sendEvent(new StoppedEvent('entry', this.THREAD_ID));
    }

    private setDebugBridge(next: DebugBridge) {
        if (this.debugBridge !== undefined) {
            next.setSelectedProxies(this.debugBridge.getSelectedProxies());
        }
        this.debugBridge = next;
        if (this.proxyCallsProvider === undefined) {
            this.proxyCallsProvider = new ProxyCallsProvider(next);
            vscode.window.registerTreeDataProvider("proxies", this.proxyCallsProvider);
        } else {
            this.proxyCallsProvider?.setDebugBridge(next);
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
        console.log(args);
        this.debugBridge?.setVariable(args.name, parseInt(args.value)).then(value => {
            console.log(`Plugin: ${value}`);
            this.debugBridge?.refresh();
        });
    }

    // Commands

    public upload() {
        this.debugBridge?.upload();
    }

    public startMultiverseDebugging() {
        this.debugBridge?.pullSession();
    }

    public popEvent() {
        this.debugBridge?.popEvent();
    }

    public toggleProxy(resource: ProxyCallItem) {
        resource.toggle();
        this.debugBridge?.updateSelectedProxies(resource);
        this.proxyCallsProvider?.refresh();
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
                new Scope("Globals", this.variableHandles.create('globals'), true)
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
            let locals: VariableInfo[] = this.debugBridge === undefined ? [] : this.debugBridge.getLocals(this.debugBridge.getCurrentFunctionIndex());
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
        } else {
            response.body = {
                variables: Array.from(this.sourceMap.globalInfos, (info) => {
                    return {name: info.name, value: info.value, variablesReference: 0};
                })
            };
            this.sendResponse(response);
        }
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse,
                                args: DebugProtocol.StackTraceArguments): void {
        const pc = this.debugBridge!.getProgramCounter();
        this.setLineNumberFromPC(pc);

        const bottom: DebugProtocol.StackFrame = new StackFrame(0,
            "module",
            this.createSource(this.program),
            1);

        const callstack = this.debugBridge === undefined
            ? [] : this.debugBridge.getCallstack();
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

}
