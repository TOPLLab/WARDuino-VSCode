import * as net from 'net';
import { ChannelInterface } from './ChannelInterface';
import { AbstractChannel } from './AbstractChannel';

type FutureResolver = (value: string | PromiseLike<string>) => void;


export class ClientSideSocket extends AbstractChannel implements ChannelInterface {

    private port: number;
    private host: string;

    constructor(port: number, host: string) {
        super(`ClientSideSocket(${host}:${port})`);
        this.port = port;
        this.host = host === "" ? "127.0.0.1" : host;
    }

    public write(data: string, cb?: ((err?: Error | undefined) => void) | undefined): boolean {
        return !!this.connection && this.connection.write(data);
    }

    public openConnection(maxAttempts: number = 1): Promise<boolean> {
        return new Promise(async (resolve) => {
            const addr = { port: this.port, host: this.host };
            let con = new net.Socket();
            let attemptedConnections = 1;
            con.connect(addr, () => { console.log(`ClientSideSocket: connecting to ${this.host}:${this.port}`); });

            con.on('data', (data: Buffer) => {
                return this.onDataHandler(data);
            });
            con.on('connect', () => {
                this.connection = con;
                resolve(true);
            });
            con.on('error', (err) => {
                console.log(`ClientSideSocket: ${err}`);
                if (!!!this.connection && attemptedConnections >= maxAttempts) {
                    resolve(false);
                }
                if (!!!this.connection) {
                    attemptedConnections++;
                    con.connect(addr);
                }
            });
        });
    }
}