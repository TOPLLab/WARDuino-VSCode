import "mocha";
import {WARDuinoDebugBridge} from "../../DebugBridges/WARDuinoDebugBridge";
import {WOODState} from "../../State/WOODState";
import {expect} from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {before, beforeEach} from "mocha";
import ErrnoException = NodeJS.ErrnoException;
import {WARDuinoDebugBridgeEmulator} from "../../DebugBridges/WARDuinoDebugBridgeEmulator";

const runPath = process.cwd();

const port = "port does not exist";
const warduinoSDK = `${require('os').homedir()}/Arduino/libraries/WARDuino`;
const wasmDirectoryPath = `${runPath}/src/test/UnitTests/TestSource/fac_ok.wasm`;
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

suite('Emulator Bridge Test Suite', () => {
    let tmpdir: string = "";
    let bridge: WARDuinoDebugBridgeEmulator;

    before(async function () {
        await new Promise(resolve => {
            fs.mkdtemp(path.join(os.tmpdir(), 'warduino.'), (err: ErrnoException | null, dir: string) => {
                if (err === null) {
                    tmpdir = dir;
                    resolve(null);
                }
            });
        });

        // TODO start emulator
    });

    test('Connect to Emulator', async () => {
        bridge = new WARDuinoDebugBridgeEmulator("",
            undefined,
            tmpdir,
            listener,
            warduinoSDK
        );
        // TODO test connection
    });
});

suite('Embedded Bridge Failure Test Suite', () => {
    let tmpdir: string = "";
    let bridge: WARDuinoDebugBridge;

    before(async function () {
        await new Promise(resolve => {
            fs.mkdtemp(path.join(os.tmpdir(), 'warduino.'), (err: ErrnoException | null, dir: string) => {
                if (err === null) {
                    tmpdir = dir;
                    resolve(null);
                }
            });
        });
    });

    beforeEach(async function () {
        bridge = new WARDuinoDebugBridge("",
            undefined,
            tmpdir,
            listener,
            port,
            warduinoSDK
        );
    });

    test('TestEstablishConnectionFailure', async () => {
        await bridge.compileAndUpload().catch(reason => {
            expect(reason.to.equal(`Could not connect to serial port: ${port}`));
        });
    });

    test('TestNoLocalDevice', async () => {
        let result = await bridge.compileAndUpload();
        expect(result).to.be.false;
    });

});