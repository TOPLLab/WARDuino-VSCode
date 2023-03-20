import {Duplex} from 'stream';
import {exec} from 'child_process';
import {SerialPort} from 'serialport';
import {SerialPortOpenOptions} from 'serialport/dist/serialport';
import * as fs from 'fs';
import * as path from 'path';

abstract class Uploader {
    abstract upload(program: string): Promise<Duplex>;

    protected removeTmpDir(tmpdir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            fs.rm(tmpdir, {recursive: true}, err => {
                if (err) {
                    reject('Could not delete temporary directory.');
                    return;
                }
                resolve();
            });
        });
    }
}

interface SerialOptions {
    path?: string,
    fqbn?: string,
    baudRate?: number
}

export class ArduinoUploader extends Uploader {
    private readonly source: string;
    private readonly sdkpath: string;
    private readonly fqbn: string;
    private readonly options: SerialPortOpenOptions<any>;

    constructor(source: string, sdkpath: string, options: SerialOptions) {
        super();
        this.source = source;
        this.sdkpath = sdkpath;
        this.fqbn = options.fqbn ?? 'esp32:esp32:esp32wrover';
        this.options = {
            path: options.path ?? '/dev/ttyUSB0',
            baudRate: options.baudRate ?? 115200
        };
    }

    public upload(): Promise<Duplex> {
        return this.stage().then(() => {
            return this.removeTmpDir(path.dirname(this.source));
        }).then(() => {
            return this.flash();
        }).then(() => {
            return this.connect();
        });
    }

    private stage(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const command = `xxd -i ${this.source} | sed -e 's/[^ ]*_wasm/upload_wasm/g' > ${this.sdkpath}/upload.h`;

            let createHeaders = exec(command);

            createHeaders.on('close', (code) => {
                if (code !== 0) {
                    reject('staging failed: unable to initialize headers');
                    return;
                }
                resolve();
            });
        }).then(() => {
            return new Promise<void>((resolve, reject) => {
                let compile = exec('make compile', {cwd: this.sdkpath});

                compile.on('close', (code) => {
                    if (code !== 0) {
                        reject('staging failed: unable to build Arduino program');
                        return;
                    }
                    resolve();
                });
            });
        });
    }

    private flash(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const command = `make flash PORT=${this.options.path} FQBN=${this.fqbn}`;

            const upload = exec(command, {cwd: this.sdkpath});

            upload.on('close', (code) => {
                if (code !== 0) {
                    reject(`unable to flash program to ${this.fqbn}`);
                    return;
                }
                resolve();
            });
        });
    }

    private connect(): Promise<Duplex> {
        return new Promise<Duplex>((resolve, reject) => {
            const connection = new SerialPort(this.options,
                (error) => {
                    if (error) {
                        reject(`could not connect to serial port: ${this.options.path}`);
                        return;
                    }
                }
            );
            connection.on('data', function (data) {
                if (data.includes('LOADED')) {
                    connection.removeAllListeners('data');
                    resolve(connection);
                }
            });
        });
    }
}