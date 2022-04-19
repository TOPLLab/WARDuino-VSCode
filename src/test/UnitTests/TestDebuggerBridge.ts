import "mocha";
import {WOODState} from "../../State/WOODState";
import {assert} from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {after, before, describe, it} from "mocha";
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

suite("Debug API Test Suite (emulated)", () => {
    let tmpdir: string = "";
    let bridge: WARDuinoDebugBridgeEmulator;

    before(async function () {
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
    });

    before(async function () {
        let compilerBridge = new WASMCompilerBridge(`${wasmDirectoryPath}/fac_ok.wast`, tmpdir);
        let result = await compilerBridge.compile();
    });

    test("Test Emulator Connection", () => {
        return bridge.connect().then(result => {
            assert.equal(result, "127.0.0.1:8192");
        });
    });

    test("Test `run` command", function (done) {
        bridge.client?.on("data", (data: string) => {
            if (data.includes("GO!")) {
                done();
            }
        });
        bridge.run();
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
        bridge.step();
    });

    test("Test `dump` command", function (done) {
        bridge.client?.on("data", (data: string) => {
            if (data.includes("{\"pc\":")) {
                done();
            }
        });
        bridge.refresh();
    });

    after(function () {
        bridge.disconnect();
        fs.rm(tmpdir, {recursive: true}, err => {
            if (err) {
                throw new Error('Could not delete temporary directory.');
            }
        });
    });
});