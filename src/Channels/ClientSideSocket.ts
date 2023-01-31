import * as net from 'net';
import { EventEmitter } from 'stream';


export class ClientSideSocket extends EventEmitter {

    private port: number;
    private host: string;
    private connection: net.Socket | undefined;
    private dataBuffered: string = "";

    constructor(port: number, host: string) {
        super();
        this.port = port;
        this.host = host;
    }

    write(data: string, cb?: ((err?: Error | undefined) => void) | undefined): boolean {
        return !!this.connection && this.connection.write(data);
    }

    openConnection(maxAttempts: number = 1): Promise<boolean> {
        return new Promise(async (resolve) => {
            const addr = { port: this.port, host: this.host };
            let con = new net.Socket();
            let attemptedConnections = 1;
            con.connect(addr, () => { console.log(`ClientSideSocket: connecting to ${this.host}:${this.port}`); });

            con.on('data', (data: Buffer) => {
                this.dataBuffered += data.toString('ascii');
                const splits = this.dataBuffered.split('\n');
                this.dataBuffered = splits[splits.length - 1];
                for (let index = 0; index < splits.length - 1; index++) {
                    const content = splits[index];
                    if (content === '') {
                        continue;
                    }
                    this.emit('data', content);
                }
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