import * as net from 'net';
import { ChannelInterface } from './ChannelInterface';
import { Request } from '../DebugBridges/APIRequest';

type FutureResolver = (value: string | PromiseLike<string>) => void;


export class ClientSideSocket implements ChannelInterface {

    private port: number;
    private host: string;
    private connection: net.Socket | undefined;
    private dataBuffered: string = "";
    private requests: [Request, FutureResolver][];
    private callbacks: [(line: string) => boolean, (line: string) => void][];
    private catchAllHandler: (line: string) => void;

    constructor(port: number, host: string) {
        this.port = port;
        this.host = host === "" ? "127.0.0.1" : host;
        this.requests = [];
        this.catchAllHandler = this.catchAllLogger;
        this.callbacks = [];
    }

    public addCallback(dataCheck: (line: string) => boolean, cb: (line: string) => void): void {
        this.callbacks.push([dataCheck, cb]);
    }


    public setCatchAllHandler(cb: (line: string) => void) {
        this.catchAllHandler = cb;
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
                this.dataBuffered += data.toString();
                this.handleLines(this.parseLines());
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

    public disconnect(): void {
        this.connection?.destroy();
        this.connection = undefined;
    }

    public request(request: Request): Promise<string> {
        return new Promise((res, rej) => {
            this.requests.push([request, res]);
            this.write(request.dataToSend, rej);
        });
    }

    private parseLines(): string[] {
        const lines = [];
        let idx = this.dataBuffered.indexOf("\n");
        while (idx !== -1) {
            const line = this.dataBuffered.slice(0, idx);
            this.dataBuffered = this.dataBuffered.slice(idx + 1); // skip newline
            console.log(`ClientSideSocket.parseLines: ${line}`);
            lines.push(line);
            idx = this.dataBuffered.indexOf("\n");
        };
        return lines;
    }

    private handleLines(lines: string[]) {
        const newRequests: [Request, FutureResolver][] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const index = this.findFutureResolver(line);
            if (index !== undefined) {
                const pair = this.requests.splice(index, 1)[0];
                const resolver = pair[1];
                resolver(line);
                continue;
            }

            const cbPair = this.callbacks.find(cbpair => {
                const check = cbpair[0];
                return check(line);
            });
            const handler = !!cbPair ? cbPair[1] : this.catchAllHandler;
            handler(line);
        }
    }

    private findFutureResolver(line: string): number | undefined {
        let i = 0;
        let resultIndex: number | undefined = undefined
        while (resultIndex === undefined && i < this.requests.length) {
            const checkForMatch = this.requests[i][0];
            if (checkForMatch.expectedResponse(line)) {
                resultIndex = i;
            }
            i += 1;
        }
        return resultIndex;
    }

    private catchAllLogger(line: string) {
        console.log(`ClientSideSocket: unhandled line "${line}"`);
    }
}