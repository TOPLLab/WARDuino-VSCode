/**
 * This file contains test suites of the WARDuino VM and debugger.
 *
 * These tests are independent of the plugin and uses the emulator version of the VM (wdcli).
 */
import 'mocha';
import {InterruptTypes} from '../../DebugBridges/InterruptTypes';
import {
    Behaviour,
    connectToDebugger,
    Describer,
    Description,
    Expected,
    isReadable,
    startDebugger,
    TestDescription,
    WARDuinoInstance
} from '../describer';
import {assert, expect} from 'chai';
import {ChildProcess, spawn} from 'child_process';
import {ReadlineParser} from 'serialport';
import * as net from 'net';

const interpreter: string = `${require('os').homedir()}/Arduino/libraries/WARDuino/build-emu/wdcli`;
const examples: string = 'src/test/suite/examples/';
let port: number = 8200;

/**
 * Test Suite of the WARDuino CLI
 */
describe('WARDuino CLI Test Suite', () => {

    /**
     * Tests to see if VM and debugger start properly
     */

    it('Test: exitcode (0)', function (done) {
        spawn(interpreter, ['--no-debug', '--file', `${examples}hello.wasm`]).on('exit', function (code) {
            expect(code).to.equal(0);
            done();
        });
    });

    it('Test: exitcode (1)', function (done) {
        spawn(interpreter, ['--socket', (port++).toString(), '--file', `${examples}nonexistent.wasm`]).on('exit', function (code) {
            expect(code).to.equal(1);
            done();
        });
    });

    it('Test: start websocket', function (done) {
        let succeeded = false;

        const process: ChildProcess = startDebugger(interpreter, `${examples}blink.wasm`, port++);
        process.on('exit', function () {
            assert.isTrue(succeeded, 'Interpreter should not exit.');
            done();
        });

        while (process.stdout === undefined) {
        }

        if (isReadable(process.stdout)) {
            const reader = new ReadlineParser();
            process.stdout.pipe(reader);

            reader.on('data', (data) => {
                if (data.includes('Listening')) {
                    succeeded = true;
                    process.kill('SIGKILL');
                }
            });
        }
    });

    it('Test: connect to websocket', async function () {
        await connectToDebugger(interpreter, `${examples}blink.wasm`, port++);
    });

    // it('Test: --proxy flag', function (done) {
    //     const address = {port: port, host: '127.0.0.1'};
    //     const proxy: net.Server = new net.Server();
    //     proxy.listen(port++);
    //     proxy.on('connection', function (socket: net.Socket) {
    //         done();
    //     });
    //
    //     connectToDebugger(interpreter, `${examples}blink.wasm`, port++, ['--proxy', address.port.toString()]).then((instance: WARDuinoInstance) => {
    //         instance.process.on('exit', function (code) {
    //             assert.fail(`Interpreter should not exit. (code: ${code})`);
    //             done();
    //         });
    //     }).catch(function (message) {
    //         assert.fail(message);
    //         done();
    //     });
    // });
});

/**
 * Tests of the Remote Debugger API
 */
const describer: Describer = new Describer(interpreter, port);

const pauseTest: TestDescription = {
    name: 'Test PAUSE',
    program: `${examples}blink.wasm`,
    instructions: [{
        name: 'execution is stopped',
        type: InterruptTypes.interruptPAUSE,
        expected: [
            {'pc' : {kind: 'description', value: Description.defined} as Expected<string>},
            {'pc' : {kind: 'behaviour', value: Behaviour.unchanged} as Expected<string>}
        ]
    }]
};

describer.describeTest(pauseTest);
