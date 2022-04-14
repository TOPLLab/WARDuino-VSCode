import "mocha";
import {WARDuinoDebugBridge} from "../../DebugBridges/WARDuinoDebugBridge";
import {WOODState} from "../../State/WOODState";
import {assert, expect} from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {before, beforeEach, after, describe, it} from "mocha";
import ErrnoException = NodeJS.ErrnoException;
import {WARDuinoDebugBridgeEmulator} from "../../DebugBridges/WARDuinoDebugBridgeEmulator";
import {WASMCompilerBridge} from "../../CompilerBridges/WASMCompilerBridge";

const runPath = process.cwd();

const port = "port does not exist";
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

suite("Emulator Bridge Test Suite", () => {
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

    before(async function() {
        let compilerBridge = new WASMCompilerBridge(`${wasmDirectoryPath}/fac_ok.wast`, tmpdir);
        let result = await compilerBridge.compile();
    });

    describe("Debug API Test", () => {
        it("Test Emulator Connection", () => {

            return bridge.connect().then(result => {
                assert.equal(result, "127.0.0.1:8192");
            });
        });

        it("Test `run` command");
        it("Test `pause` command");
        it("Test `step` command");
        it("Test `dump` command");
    });

    after(function() {
        bridge.disconnect();
        fs.rm(tmpdir, {recursive: true}, err => {
            if (err) {
                throw new Error('Could not delete temporary directory.');
            }
        });
    });
});