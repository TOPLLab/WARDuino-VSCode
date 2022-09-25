// Tests specific to the debugger
import "mocha";

import {ChildProcess, spawn} from "child_process";
import {Readable} from "stream";
import {assert, expect} from "chai";
import {ReadlineParser} from "serialport";

const interpreter = `${require('os').homedir()}/Arduino/libraries/WARDuino/build-emu/wdcli`;
const examples = 'src/test/suite/examples/';

function isReadable(x: Readable | null): x is Readable {
    return x !== null;
}

suite('Debugger Test Suite', () => {

    let port: number = 8192;

    test('Test exitcode (0)', function (done) {
        const process = spawn(interpreter, ['--no-debug', '--file', `${examples}hello.wasm`]).on('exit', function (code) {
            expect(code).to.equal(0);
            process.kill("SIGKILL");
            done();
        });
    });

    test('Test exitcode (-1)', function (done) {
        spawn(interpreter, ['--socket', (port++).toString(), '--file', `${examples}nonexistent.wasm`]).on('exit', function (code) {
            expect(code).to.equal(1);
            done();
        });
    });

    test('Start websocket', function (done) {
        this.timeout(5000);

        let succeeded = false;

        const process: ChildProcess = spawn(interpreter, ['--socket', (port++).toString(), '--file', `${examples}blink.wasm`]);
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
                    process.kill("SIGKILL");
                }
            });
        }
    });
});
