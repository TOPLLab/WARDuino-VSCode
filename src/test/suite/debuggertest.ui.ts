import 'mocha';
import {WOODState} from '../../State/WOODState';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {after, before, beforeEach} from 'mocha';
import {EmulatedDebugBridge} from '../../DebugBridges/EmulatedDebugBridge';
import {WASMCompilerBridge} from '../../CompilerBridges/WASMCompilerBridge';
import {RunTimeTarget} from '../../DebugBridges/RunTimeTarget';
import {WOODDebugBridge} from '../../DebugBridges/WOODDebugBridge';
import {DebugBridgeListener} from '../../DebugBridges/DebugBridgeListener';
import {HardwareDebugBridge} from '../../DebugBridges/HardwareDebugBridge';
import {DebugBridge} from '../../DebugBridges/DebugBridge';
import ErrnoException = NodeJS.ErrnoException;

const TIMEOUT = 100000;

const runPath = process.cwd();
const warduinoSDK = `${require('os').homedir()}/Arduino/libraries/WARDuino`;
const wabtSDK = `${runPath}/WABT/build`;
const wasmDirectoryPath = `${runPath}/src/test/suite/examples`;
const listener: DebugBridgeListener = {
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
    }
};

let tmpdir: string = '';
let bridge: DebugBridge;

async function init(target: RunTimeTarget) {
    await new Promise(resolve => {
        fs.mkdtemp(path.join(os.tmpdir(), 'warduino.'), (err: ErrnoException | null, dir: string) => {
            if (err === null) {
                tmpdir = dir;
                switch (target) {
                    case RunTimeTarget.wood:
                        bridge = new WOODDebugBridge(
                            undefined,
                            undefined,
                            tmpdir,
                            listener,
                            warduinoSDK
                        );
                        break;
                    case RunTimeTarget.embedded:
                        bridge = new HardwareDebugBridge(
                            undefined,
                            undefined,
                            tmpdir,
                            listener,
                            '/dev/ttyUSB0',
                            'esp32:esp32:esp32wrover',
                            warduinoSDK);
                        break;
                    case RunTimeTarget.emulator:
                    default:
                        bridge = new EmulatedDebugBridge(
                            undefined,
                            undefined,
                            tmpdir,
                            listener,
                            warduinoSDK
                        );
                        break;
                }
                resolve(null);
            }
        });
    });

    let compilerBridge = new WASMCompilerBridge(`${wasmDirectoryPath}/fac_ok.wast`, tmpdir, wabtSDK);
    await compilerBridge.compile();
}

// describe("EmulatedDebugBridge Test Suite", () => {
//
//     before(async function () {
//         await init(RunTimeTarget.emulator);
//     });
//
//     it("Test Emulator Connect", () => {
//         return bridge.connect().then(result => {
//             assert.equal(result, "127.0.0.1:8192");
//         });
//     });
//
//     it("Test Emulator Disconnect", async function () {
//         bridge.disconnect();
//         fs.rm(tmpdir, {recursive: true}, err => {
//             if (err) {
//                 throw new Error('Could not delete temporary directory.');
//             }
//         });
//     });
// });

function isValidJSON(text: string): boolean {
    try {
        JSON.parse(text);
    } catch (e) {
        return false;
    }
    return true;
}

function receivingDumpData(json: string, text: string): boolean {
    return json.length > 0 || text.includes('{"pc":');
}

describe('Debug API Test Suite (plugin)', () => {
    before(async function () {
        this.timeout(TIMEOUT);
        await init(RunTimeTarget.embedded);
        await bridge.connect();
    });

    beforeEach(() => {
        bridge.client?.removeAllListeners('data');
    });

    it('Test `pause` command', function (done) {
        bridge.client?.on('data', (data: Buffer) => {
            const text = data.toString();
            console.log(text);
            if (text.includes('PAUSE!')) {
                done();
            }
        });
        bridge.pause();
    });

    it('Test `step` command', function (done) {
        bridge.client?.on('data', (data: Buffer) => {
            const text = data.toString();
            console.log(text);
            if (text.includes('STEP!')) {
                done();
            }
        });
        bridge.step();
    });

    it('Test `dump` command', function (done) {
        this.timeout(3000);
        let json = '';

        bridge.client?.on('data', (data: Buffer) => {
            const text = data.toString();
            console.log(text);
            if (receivingDumpData(json, text)) {
                let lines = text.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (receivingDumpData(json, lines[i])) {
                        json += lines[i].trimEnd();
                        if (isValidJSON(json)) {
                            json = '';
                            done();
                            break;
                        }
                    }
                }
            }
        });
        bridge.refresh();
    });

    it('Test `run` command', function (done) {
        bridge.client?.on('data', (data: Buffer) => {
            const text = data.toString();
            console.log(text);
            if (text.includes('GO!')) {
                done();
            }
        });
        bridge.run();
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
