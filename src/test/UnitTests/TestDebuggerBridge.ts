import "mocha";
import {WOODState} from "../../State/WOODState";
import {assert} from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {after, afterEach, before} from "mocha";
import {WARDuinoDebugBridgeEmulator} from "../../DebugBridges/WARDuinoDebugBridgeEmulator";
import {WASMCompilerBridge} from "../../CompilerBridges/WASMCompilerBridge";
import ErrnoException = NodeJS.ErrnoException;

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

suite("Debug API Test Suite (emulated)", () => {
    before(async function () {
        await init();
        await bridge.connect();
    });

    test("Test `pause` command", function (done) {
        bridge.client?.on("data", (data: string) => {
            if (data.includes("PAUSE!")) {
                done();
            }
        });
        bridge.pause();
    });

    test("Test `step` command", function (done) {
        bridge.client?.on("data", (data: string) => {
            if (data.includes("STEP!")) {
                done();
            }
        });
        bridge.pause();
        bridge.step();
    });

    test("Test `dump` command", function (done) {
        this.timeout(3000);
        let json = "";

        bridge.client?.on("data", (data: Buffer) => {
            const text = data.toString();
            if (text.includes("{\"pc\":")) {
                text.split("\n").forEach(line => {
                    console.log(line);
                    if (json.length > 0 || line.startsWith("{\"pc\":")) {
                        json += line.trimEnd();
                        try {
                            JSON.parse(json);
                        } catch (e) {
                            return;
                        }
                        json = "";
                        done();
                    }
                });
            }
        });
        bridge.pause();
        bridge.refresh();
    });

    test("Test `run` command", function (done) {
        bridge.client?.on("data", (data: string) => {
            if (data.includes("GO!")) {
                done();
            }
        });
        bridge.run();
    });

    afterEach(() => {
        bridge.client?.removeAllListeners("data");
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