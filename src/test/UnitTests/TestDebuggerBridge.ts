import "mocha";
import { WOODState } from "../../State/WOODState";
import { assert } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { after, before, beforeEach } from "mocha";
import { EmulatedDebugBridge } from "../../DebugBridges/EmulatedDebugBridge";
import { WASMCompilerBridge } from "../../CompilerBridges/WASMCompilerBridge";
import { RunTimeTarget } from "../../DebugBridges/RunTimeTarget";
import { WOODDebugBridge } from "../../DebugBridges/WOODDebugBridge";
import { DebugBridgeListenerInterface } from "../../DebugBridges/DebugBridgeListenerInterface";
import ErrnoException = NodeJS.ErrnoException;
import { DeviceConfig } from "../../DebuggerConfig";
import { EmptySourceMap } from "../../State/SourceMap";
import { RuntimeViewsRefresher } from "../../Views/ViewsRefresh";
import { DebugBridge } from "../../DebugBridges/DebugBridge";
import { PauseRequest, RunRequest, StateRequest } from "../../DebugBridges/APIRequest";

const runPath = process.cwd();
const warduinoSDK = `${require('os').homedir()}/Arduino/libraries/WARDuino`;
const wabtSDK = `${runPath}/WABT/build`;
const wasmDirectoryPath = `${runPath}/src/test/UnitTests/TestSource`;
const listener: DebugBridgeListenerInterface = {
    notifyDisallowedOperation(message: string) {
    },
    setBridge(debugBridge: DebugBridge) {
    },
    notifyProgressInNotification(title: string, message: string) {
    },
    notifyConnected(): void {
    },
    notifyError(): void {
    },
    connected(): void {
    },
    startMultiverseDebugging(woodState: WOODState): void {
    },
    notifyPaused(): void {
    },
    notifyBreakpointHit(): void {
    },
    disconnected(): void {
    },
    notifyProgress(message: string): void {
        console.log(message);
    },
    notifyStateUpdate() {
    },
    notifyException(message: string): void {
    },
    notifyInfoMessage(message) {
    },
    runEvent() {
    }
};

let tmpdir: string = "";
let bridge: EmulatedDebugBridge;

async function init(target: RunTimeTarget) {
    await new Promise(resolve => {
        fs.mkdtemp(path.join(os.tmpdir(), 'warduino.'), (err: ErrnoException | null, dir: string) => {
            if (err === null) {
                tmpdir = dir;
                switch (target) {
                    case RunTimeTarget.wood:
                        bridge = new WOODDebugBridge("",
                            //TODO fix
                            DeviceConfig.defaultDeviceConfig("wood"),
                            EmptySourceMap(),
                            tmpdir,
                            listener,
                            warduinoSDK
                        );
                        break;
                    case RunTimeTarget.emulator:
                    default:
                        bridge = new EmulatedDebugBridge("",
                            DeviceConfig.defaultDeviceConfig("emulated"),
                            EmptySourceMap(),
                            tmpdir,
                            listener,
                            warduinoSDK
                        );
                        break;
                }
                resolve(null);
            }
        }
        );
    });

    let compilerBridge = new WASMCompilerBridge(`${wasmDirectoryPath}/fac_ok.wast`, tmpdir, wabtSDK);
    await compilerBridge.compile();
}

suite("EmulatedDebugBridge Test Suite", () => {

    before(async function () {
        await init(RunTimeTarget.emulator);
    });

    test("Test Emulator Connect", () => {
        return bridge.connect().then(result => {
            assert.equal(result, "127.0.0.1:8192");
        });
    });

    test("Test Emulator Disconnect", async function () {
        bridge.disconnect();
        fs.rm(tmpdir, { recursive: true }, err => {
            if (err) {
                throw new Error('Could not delete temporary directory.');
            }
        });
    });
});

function isValidJSON(text: string): boolean {
    try {
        JSON.parse(text);
    } catch (e) {
        return false;
    }
    return true;
}

function receivingDumpData(json: string, text: string): boolean {
    return json.length > 0 || text.includes("{\"pc\":");
}

suite("Debug API Test Suite (emulated)", () => {
    before(async function () {
        await init(RunTimeTarget.emulator);
        await bridge.connect();
    });

    beforeEach(() => {
        bridge.client?.removeDataHandlers();
    });

    test("Test `pause` command", async function (done) {
        const pauseRequest = PauseRequest;
        const response = await bridge.client?.request(pauseRequest);
        if (response === "PAUSE!") {
            done()
        }
    });

    test("Test `step` command", async function (done) {
        await bridge.step();
        done();
    });

    test("Test `dump` command", async function (done) {
        this.timeout(3000);
        const stateRequest = new StateRequest();
        stateRequest.includePC();
        stateRequest.includeStack();
        stateRequest.includeGlobals();
        stateRequest.includeCallstack();
        stateRequest.includeBreakpoints();
        stateRequest.includeEvents();
        const req = stateRequest.generateRequest();
        const response = await bridge.client!.request(req);
        if (isValidJSON(response)) {
            done();
        }
    });

    test("Test `run` command", async function (done) {
        const runRequest = RunRequest;
        const response = await bridge.client?.request(runRequest);
        if (response === "GO!") {
            done();
        }
    });

    after(async function () {
        bridge.disconnect();
        fs.rm(tmpdir, { recursive: true }, err => {
            if (err) {
                throw new Error('Could not delete temporary directory.');
            }
        });
    });
});

suite("WOOD Debug API Test Suite (emulated)", () => {
    before(async function () {
        await init(RunTimeTarget.wood);
        await bridge.connect();
    });

    beforeEach(() => {
        bridge.client?.removeDataHandlers();
    });

    test("Test `WOODDUMP` command", async function (done) {
        this.timeout(10000);
        class DummyState extends WOODState {
            constructor() {
                super("", JSON.parse(""));
            }

            toBinary(): string[] {
                return [
                    '62000000200400000003050000000000000000000000000600000000000000000000000000 ',
                    '62000001ED010655CDD3E59989080001000000000003000100FFFFFFFFFFFFFFFF0655CDD3E5996F000000040400000003001700000000010000000000000000070000006A000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000 ',
                    '62000001EE07006B00E400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000…00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000 ',
                    '62000000720700E500FF00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001 ',
                    ''
                ];
            }
        }

        await bridge.pushSession(new DummyState());
        done();
    });

    after(async function () {
        bridge.disconnect();
        fs.rm(tmpdir, { recursive: true }, err => {
            if (err) {
                throw new Error('Could not delete temporary directory.');
            }
        });
    });
});
