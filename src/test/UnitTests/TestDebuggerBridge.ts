import "mocha";
import {WOODState} from "../../State/WOODState";
import {assert} from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {after, before, beforeEach} from "mocha";
import {WARDuinoDebugBridgeEmulator} from "../../DebugBridges/WARDuinoDebugBridgeEmulator";
import {WASMCompilerBridge} from "../../CompilerBridges/WASMCompilerBridge";
import ErrnoException = NodeJS.ErrnoException;
import {InterruptTypes} from "../../DebugBridges/InterruptTypes";

const runPath = process.cwd();
const warduinoSDK = `${require('os').homedir()}/Arduino/libraries/WARDuino`;
const wasmDirectoryPath = `${runPath}/src/test/UnitTests/TestSource`;
const listener = {
    notifyError(): void {

    },
    connected(): void {

    },
    startMultiverseDebugging(woodState: WOODState): void {

    },
    notifyPaused(): void {

    },
    disconnected(): void {

    },
    notifyProgress(message: string): void {
        console.log(message);
    },
    notifyStateUpdate() {
    }
};

let tmpdir: string = "";
let bridge: WARDuinoDebugBridgeEmulator;

async function init() {
    await new Promise(resolve => {
        fs.mkdtemp(path.join(os.tmpdir(), 'warduino.'), (err: ErrnoException | null, dir: string) => {
            if (err === null) {
                tmpdir = dir;
                bridge = new WARDuinoDebugBridgeEmulator("",
                    undefined,
                    tmpdir,
                    listener,
                    warduinoSDK
                );
                resolve(null);
            }
        });
    });

    let compilerBridge = new WASMCompilerBridge(`${wasmDirectoryPath}/fac_ok.wast`, tmpdir);
    await compilerBridge.compile();
}

suite("WARDuinoDebugBridgeEmulator Test Suite", () => {

    before(async function () {
        await init();
    });

    test("Test Emulator Connect", () => {
        return bridge.connect().then(result => {
            assert.equal(result, "127.0.0.1:8192");
        });
    });

    test("Test Emulator Disconnect", async function () {
        bridge.disconnect();
        fs.rm(tmpdir, {recursive: true}, err => {
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
        await init();
        await bridge.connect();
    });

    beforeEach(() => {
        bridge.client?.removeAllListeners("data");
    });

    test("Test `pause` command", function (done) {
        bridge.client?.on("data", (data: Buffer) => {
            const text = data.toString();
            console.log(text);
            if (text.includes("PAUSE!")) {
                done();
            }
        });
        bridge.pause();
    });

    test("Test `step` command", function (done) {
        bridge.client?.on("data", (data: Buffer) => {
            const text = data.toString();
            console.log(text);
            if (text.includes("STEP!")) {
                done();
            }
        });
        bridge.step();
    });

    test("Test `dump` command", function (done) {
        this.timeout(3000);
        let json = "";

        bridge.client?.on("data", (data: Buffer) => {
            const text = data.toString();
            console.log(text);
            if (receivingDumpData(json, text)) {
                let lines = text.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    if (receivingDumpData(json, lines[i])) {
                        json += lines[i].trimEnd();
                        if (isValidJSON(json)) {
                            json = "";
                            done();
                            break;
                        }
                    }
                }
            }
        });
        bridge.refresh();
    });

    test("Test `run` command", function (done) {
        bridge.client?.on("data", (data: Buffer) => {
            const text = data.toString();
            console.log(text);
            if (text.includes("GO!")) {
                done();
            }
        });
        bridge.run();
    });

    test("Test `WOODDUMP` command", function (done) {
        bridge.client?.on("data", (data: Buffer) => {
            const text = data.toString();
            console.log(text);
            if (text.includes("ack!")) {
                done();
            }
        });
        let binary = "NjIwMDAwMDAyMDA0MDAwMDAwMDMwNTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA2MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAgCjYyMDAwMDAxRUQwMTA2NTYzRUQ1QzM0OThFMDgwMDAxMDBFODAzMDAwMDAzMDAwMTAwRkZGRkZGRkZGRkZGRkZGRjA2NTYzRUQ1QzM0OTZGMDAwMDAwMDQwNDAwMDAwMDAzMDAxNzAwMDAwMDAwMDEwMDAwMDAwMDAwMDAwMDAwMDcwMDAwMDA2QTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCAKNjIwMDAwMDFFRTA3MDA2QjAwRTQwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAgCjYyMDAwMDAwNzIwNzAwRTUwMEZGMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDEgCg=="
        bridge.client?.write(`${InterruptTypes.interruptWOODRecvState}${binary} \n`);
    });

    after(async function () {
        bridge.disconnect();
        fs.rm(tmpdir, {recursive: true}, err => {
            if (err) {
                throw new Error('Could not delete temporary directory.');
            }
        });
    });
});