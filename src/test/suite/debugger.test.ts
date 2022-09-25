// Tests specific to the debugger
import "mocha";

import {ChildProcess, spawn} from "child_process";
import {Readable} from "stream";
import {assert, expect} from "chai";
import {ReadlineParser} from "serialport";
import * as net from 'net';
import {InterruptTypes} from "../../DebugBridges/InterruptTypes";
import {DebugInfoParser} from "../../Parsers/DebugInfoParser";
import {RuntimeState} from "../../State/RuntimeState";
import {EventItem} from "../../Views/EventsProvider";

const interpreter = `${require('os').homedir()}/Arduino/libraries/WARDuino/build-emu/wdcli`;
const examples = 'src/test/suite/examples/';

let port: number = 8192;

function isReadable(x: Readable | null): x is Readable {
    return x !== null;
}

function connectToDebugger(program: string): Promise<net.Socket> {
    const address = {port: port, host: "127.0.0.1"};
    const process = spawn(interpreter, ['--socket', (port++).toString(), '--file', program]);

    return new Promise(function (resolve, reject) {
        while (process.stdout === undefined) {
        }

        if (isReadable(process.stdout)) {
            const reader = new ReadlineParser();
            process.stdout.pipe(reader);

            reader.on('data', (data) => {
                if (data.includes('Listening')) {
                    const client = new net.Socket();
                    client.connect(address, () => {
                        resolve(client);
                    });
                }
            });
        } else {
            reject();
        }
    });
}

suite('Debugger Test Suite', () => {

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

    test('Test pause', async function () {
        this.timeout(5000);
        const socket: net.Socket = await connectToDebugger(`${examples}blink.wasm`);

        // save returned program counters
        const counters: number[] = [];
        socket.on("data", (data: Buffer) => {
            data.toString().split("\n").forEach((line) => {
                if (line.startsWith("{\"pc")) {
                    const parsed = JSON.parse(line);
                    counters.push(parseInt(parsed.pc));
                }
            });
        });

        // run test
        socket.write(`${InterruptTypes.interruptPAUSE} \n`);
        socket.write(`${InterruptTypes.interruptDUMP} \n`);
        await new Promise(f => setTimeout(f, 1000));
        socket.write(`${InterruptTypes.interruptDUMP} \n`);

        await new Promise(f => setTimeout(f, 1000));

        // perform checks
        expect(counters.length).to.equal(2);
        expect(counters[0]).to.equal(counters[1]);
    });
});
