import * as net from 'net';
import { EventEmitter } from 'stream';


export class ClientSideSocket extends EventEmitter{

    private port: number;
    private host: string;
    private connection: net.Socket | undefined;

    constructor(port: number, host: string) {
        super();
        this.port = port;
        this.host = host;
    }
    
    write(data: string, cb?: ((err?: Error| undefined) => void) | undefined): boolean {
        return !!this.connection && this.connection.write(data);
    }

    openConnection(maxAttempts: number = 1): Promise<boolean> {
        return new Promise(async (resolve) => {
            const addr = { port: this.port, host: this.host };
            let con = new net.Socket();
            let attemptedConnections = 1;
            con.connect(addr, () => {console.log(`ClientSideSocket: connecting to ${this.host}:${this.port}`);});

            con.on('data', (data: Buffer) =>{
                //TODO emit data just for each newline
                this.emit('data', data.toString('ascii'));
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
                if(!!!this.connection){
                    attemptedConnections++;
                    con.connect(addr);
                }
            });
        });
    }
}